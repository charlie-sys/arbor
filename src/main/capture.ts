import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { store, uid } from './store'
import { translateImage, translateLayoutBlocks } from './llm'
import { groupLines, ocrImage } from './ocr'
import type { RenderBlock, RenderRequest, TranslationRecord, TranslationResult } from '../shared/types'

type Item = { type: 'status'; status: 'selecting' | 'capturing' | 'translating' | 'canceled' | 'error'; message?: string } | { type: 'result'; result: TranslationResult }

let overlay: BrowserWindow | null = null
let pendingDisplay: Electron.Display | null = null
let busy = false
let mainWindowGetter: () => BrowserWindow | null = () => null

interface PendingRender {
  resolve: (dataUrl: string | null) => void
  timer: NodeJS.Timeout
}
const pendingRenders = new Map<string, PendingRender>()

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function resolveRenderResponse(requestId: string, dataUrl: string | null): void {
  const pending = pendingRenders.get(requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingRenders.delete(requestId)
  pending.resolve(dataUrl)
}

async function requestRender(imagePath: string, blocks: RenderBlock[]): Promise<string | null> {
  const win = mainWindowGetter()
  if (!win || win.isDestroyed()) return null
  let image: Buffer
  try {
    image = await fs.readFile(imagePath)
  } catch {
    return null
  }
  return new Promise((resolve) => {
    const requestId = uid()
    const timer = setTimeout(() => {
      pendingRenders.delete(requestId)
      resolve(null)
    }, 20000)
    pendingRenders.set(requestId, { resolve, timer })
    const payload: RenderRequest = {
      requestId,
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      blocks
    }
    try {
      win.webContents.send('translate:render-request', payload)
    } catch {
      clearTimeout(timer)
      pendingRenders.delete(requestId)
      resolve(null)
    }
  })
}

export function initCapture(getter: () => BrowserWindow | null): void {
  mainWindowGetter = getter
}

export function isCapturing(): boolean {
  return !!overlay || busy
}

function emit(payload: Item, focus = false): void {
  const win = mainWindowGetter()
  if (!win || win.isDestroyed()) return
  win.webContents.send('translate:event', payload)
  if (focus) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function overlayUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? `${devUrl}/overlay.html` : 'zotapp://bundle/overlay.html'
}

export function startCapture(): { ok: boolean; reason?: string } {
  if (overlay || busy) return { ok: false, reason: '已有截图任务正在进行' }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  pendingDisplay = display

  overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.on('closed', () => {
    overlay = null
    pendingDisplay = null
    if (!busy) emit({ type: 'status', status: 'canceled' })
  })

  void overlay.loadURL(overlayUrl())
  overlay.once('ready-to-show', () => {
    overlay?.show()
    overlay?.focus()
  })
  emit({ type: 'status', status: 'selecting' })
  return { ok: true }
}

export function cancelCapture(): void {
  if (!overlay) return
  const win = overlay
  overlay = null
  pendingDisplay = null
  if (!win.isDestroyed()) win.destroy()
}

export async function captureSelection(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
  const display = pendingDisplay
  const win = overlay
  if (!display || !win || busy) return
  if (rect.width < 6 || rect.height < 6) {
    cancelCapture()
    return
  }

  busy = true
  const id = uid()
  const imageFile = `${id}.png`
  const imagePath = path.join(store.translationsDir, imageFile)
  let translatedImagePath: string | undefined

  try {
    win.hide()
    await delay(180)

    const scale = display.scaleFactor || 1
    const thumbWidth = Math.max(1, Math.round(display.size.width * scale))
    const thumbHeight = Math.max(1, Math.round(display.size.height * scale))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight },
      fetchWindowIcons: false
    })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) throw new Error('未获取到屏幕画面')
    const shot = source.thumbnail
    if (shot.isEmpty()) throw new Error('屏幕截图失败')

    const shotSize = shot.getSize()
    const ratioX = shotSize.width / display.size.width
    const ratioY = shotSize.height / display.size.height
    const cropX = Math.max(0, Math.round(rect.x * ratioX))
    const cropY = Math.max(0, Math.round(rect.y * ratioY))
    const cropW = Math.min(shotSize.width - cropX, Math.round(rect.width * ratioX))
    const cropH = Math.min(shotSize.height - cropY, Math.round(rect.height * ratioY))
    if (cropW < 4 || cropH < 4) throw new Error('选区太小，请重新截图')

    const cropped = shot.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
    await fs.writeFile(imagePath, cropped.toPNG())

    if (win && !win.isDestroyed()) win.destroy()
    overlay = null
    pendingDisplay = null

    emit({ type: 'status', status: 'translating' }, true)

    const translated = await translateImage(imagePath)

    let translatedImageFile: string | undefined
    try {
      emit({ type: 'status', status: 'translating', message: '正在生成译文截图…' }, true)
      const ocr = await ocrImage(imagePath)
      if (ocr) {
        const blocks = groupLines(ocr.lines)
        if (blocks.length) {
          const translations = await translateLayoutBlocks(
            blocks.map(({ id: blockId, text }) => ({ id: blockId, text }))
          )
          const renderBlocks: RenderBlock[] = blocks
            .filter((block) => translations.has(block.id))
            .map((block) => ({ ...block, text: translations.get(block.id) as string }))
          if (renderBlocks.length) {
            const dataUrl = await requestRender(imagePath, renderBlocks)
            if (dataUrl?.startsWith('data:image/png;base64,')) {
              translatedImageFile = `${id}-translated.png`
              translatedImagePath = path.join(store.translationsDir, translatedImageFile)
              await fs.writeFile(translatedImagePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
            }
          }
        }
      }
    } catch (layoutError) {
      console.warn('生成译文截图失败：', (layoutError as Error).message)
    }

    const record: TranslationRecord = {
      id,
      createdAt: Date.now(),
      imageFile,
      translatedImageFile,
      structured: translated.structured,
      plain: translated.plain,
      model: translated.model
    }
    await store.addTranslation(record)
    emit({
      type: 'result',
      result: {
        id: record.id,
        structured: record.structured,
        plain: record.plain,
        model: record.model,
        createdAt: record.createdAt,
        imageUrl: `zotfile://translations/${record.imageFile}`,
        translatedImageUrl: translatedImageFile ? `zotfile://translations/${translatedImageFile}` : undefined
      }
    }, true)
  } catch (err) {
    await fs.unlink(imagePath).catch(() => undefined)
    if (translatedImagePath) await fs.unlink(translatedImagePath).catch(() => undefined)
    emit({ type: 'status', status: 'error', message: (err as Error).message || '截图翻译失败' }, true)
  } finally {
    busy = false
    if (win && !win.isDestroyed()) win.destroy()
    overlay = null
    pendingDisplay = null
  }
}
