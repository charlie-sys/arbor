import { OPS, Util } from 'pdfjs-dist'
import type { DocumentToneId } from '@shared/types'

export interface DocumentToneMeta {
  id: DocumentToneId
  label: string
  description: string
  swatches: [string, string]
}

export const DOCUMENT_TONES: DocumentToneMeta[] = [
  { id: 'original', label: '原色', description: '保持 PDF 原始配色', swatches: ['#ffffff', '#f2ece4'] },
  { id: 'paper', label: '暖纸', description: '低饱和奶油底，长时间阅读更柔和', swatches: ['#f7efdf', '#e9dcc6'] },
  { id: 'eye-care', label: '护眼', description: '柔和绿纸，降低眩光', swatches: ['#e9f0e3', '#dbe6d3'] },
  { id: 'night', label: '夜间', description: '深色阅读，插图保留原色', swatches: ['#1b1815', '#100e0c'] },
  { id: 'high-contrast', label: '高对比', description: '增强浅色扫描件的文字对比', swatches: ['#ffffff', '#d8d8d8'] }
]

export const TONE_STORAGE_KEY = 'zotagent-reader-tone-v1'

export function isDocumentToneId(value: unknown): value is DocumentToneId {
  return DOCUMENT_TONES.some((tone) => tone.id === value)
}

export function readLastTone(): DocumentToneId {
  const stored = window.localStorage.getItem(TONE_STORAGE_KEY)
  return isDocumentToneId(stored) ? stored : 'original'
}

export function writeLastTone(tone: DocumentToneId): void {
  window.localStorage.setItem(TONE_STORAGE_KEY, tone)
}

export function toneById(id: DocumentToneId): DocumentToneMeta {
  return DOCUMENT_TONES.find((tone) => tone.id === id) ?? DOCUMENT_TONES[0]
}

interface ImageRect {
  x: number
  y: number
  width: number
  height: number
}

const boundsCache = new WeakMap<object, Promise<ImageRect[]>>()

function unitRect(matrix: number[]): ImageRect {
  const points = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ].map(([x, y]) => {
    const point = [x, y]
    Util.applyTransform(point, matrix)
    return point
  })
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

function addRect(rects: ImageRect[], rect: ImageRect): void {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.width <= 0 || rect.height <= 0) return
  const duplicate = rects.some(
    (item) =>
      Math.abs(item.x - rect.x) < 0.5 &&
      Math.abs(item.y - rect.y) < 0.5 &&
      Math.abs(item.width - rect.width) < 0.5 &&
      Math.abs(item.height - rect.height) < 0.5
  )
  if (!duplicate) rects.push(rect)
}

/** 生成只含高饱和色像素的遮罩，矢量插图的彩色元素不会被色调滤镜反色 */
function drawColorPreserve(context: CanvasRenderingContext2D, source: HTMLCanvasElement): void {
  if (source.width * source.height > 12_000_000) return
  const sourceContext = source.getContext('2d')
  if (!sourceContext) return
  let image: ImageData
  try {
    image = sourceContext.getImageData(0, 0, source.width, source.height)
  } catch {
    return
  }
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) {
      data[i + 3] = 0
      continue
    }
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 48 || max - min < 26) data[i + 3] = 0
  }
  const mask = document.createElement('canvas')
  mask.width = source.width
  mask.height = source.height
  const maskContext = mask.getContext('2d')
  if (!maskContext) return
  maskContext.putImageData(image, 0, 0)
  context.drawImage(mask, 0, 0)
}

async function collectImageBounds(pdfPage: any): Promise<ImageRect[]> {
  const cached = boundsCache.get(pdfPage)
  if (cached) return cached
  const task = (async (): Promise<ImageRect[]> => {
    try {
      const operatorList = await pdfPage.getOperatorList()
      const fns: number[] = operatorList.fnArray
      const argsList: any[] = operatorList.argsArray
      const rects: ImageRect[] = []
      let ctm = [1, 0, 0, 1, 0, 0]
      const stack: number[][] = []
      for (let i = 0; i < fns.length; i++) {
        const fn = fns[i]
        const args = argsList[i]
        if (fn === OPS.save) {
          stack.push(ctm)
          ctm = [...ctm]
        } else if (fn === OPS.restore) {
          ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        } else if (fn === OPS.transform) {
          // transform 算子的 args 本身就是 6 元矩阵；兼容部分版本包装成 [matrix]
          const matrix = Array.isArray(args) && typeof args[0] === 'number' ? args : args?.[0]
          if (matrix) ctm = Util.transform(ctm, matrix)
        } else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm)
          ctm = args?.[0] ? Util.transform(ctm, args[0]) : [...ctm]
        } else if (fn === OPS.paintFormXObjectEnd) {
          ctm = stack.pop() ?? ctm
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          addRect(rects, unitRect(ctm))
        } else if (fn === OPS.paintImageXObjectRepeat) {
          const positions = args?.[3]
          if (Array.isArray(positions)) {
            const scaleX = Number(args[1]) || 1
            const scaleY = Number(args[2]) || 1
            for (let j = 0; j + 1 < positions.length; j += 2) {
              addRect(rects, unitRect(Util.transform(ctm, [scaleX, 0, 0, scaleY, positions[j], positions[j + 1]])))
            }
          }
        } else if (fn === OPS.paintImageMaskXObjectGroup) {
          for (const image of args?.[0] ?? []) {
            if (image?.transform) addRect(rects, unitRect(Util.transform(ctm, image.transform)))
          }
        } else if (fn === OPS.paintInlineImageXObjectGroup) {
          for (const entry of args?.[1] ?? []) {
            if (entry?.transform) addRect(rects, unitRect(Util.transform(ctm, entry.transform)))
          }
        } else if (fn === OPS.paintImageMaskXObjectRepeat) {
          const positions = args?.[5]
          if (Array.isArray(positions)) {
            const matrix = [args[1] ?? 1, args[2] ?? 0, args[3] ?? 0, args[4] ?? 1, 0, 0]
            for (let j = 0; j + 1 < positions.length; j += 2) {
              addRect(
                rects,
                unitRect(
                  Util.transform(ctm, [
                    matrix[0],
                    matrix[1],
                    matrix[2],
                    matrix[3],
                    positions[j],
                    positions[j + 1]
                  ])
                )
              )
            }
          }
        }
      }
      return rects
    } catch {
      return []
    }
  })()
  boundsCache.set(pdfPage, task)
  return task
}

interface PreserveOptions {
  pageDiv: HTMLElement
  pageView: any
  pdf: any
  pageNumber: number
  tone: DocumentToneId
  layer?: HTMLCanvasElement
  bounds?: ImageRect[]
  onBounds(bounds: ImageRect[]): void
}

/** 在色调滤镜之上复制图片区域，保证插图保持原色 */
export function paintToneImagePreserve(options: PreserveOptions): HTMLCanvasElement | null {
  const { pageDiv, pageView, pdf, pageNumber, tone, bounds, onBounds } = options
  const source = pageDiv.querySelector('.canvasWrapper > canvas') as HTMLCanvasElement | null
  if (!source || !source.width || !source.height) return null
  let rects = bounds
  if (!rects) {
    void pdf
      .getPage(pageNumber)
      .then((page: any) => collectImageBounds(page))
      .then(onBounds)
    rects = []
  }
  let overlay = options.layer
  if (!overlay || !overlay.isConnected || overlay.parentElement !== pageDiv) {
    overlay = document.createElement('canvas')
    overlay.className = 'doc-tone-image-layer'
    pageDiv.appendChild(overlay)
  }
  if (overlay.width !== source.width || overlay.height !== source.height) {
    overlay.width = source.width
    overlay.height = source.height
  }
  overlay.style.width = source.style.width || `${source.clientWidth}px`
  overlay.style.height = source.style.height || `${source.clientHeight}px`
  const context = overlay.getContext('2d')
  if (!context) return overlay
  if (tone === 'original') return overlay

  const pageWidth = pageDiv.clientWidth || 1
  const pageHeight = pageDiv.clientHeight || 1
  const scaleX = source.width / pageWidth
  const scaleY = source.height / pageHeight
  const transform = pageView.viewport?.transform as number[] | undefined
  if (!transform) return overlay
  const pageArea = pageWidth * pageHeight
  let covered = 0

  for (const rect of rects) {
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height]
    ].map(([x, y]) => {
      const point = [x, y]
      Util.applyTransform(point, transform)
      return point
    })
    const minX = Math.min(...corners.map((point) => point[0]))
    const maxX = Math.max(...corners.map((point) => point[0]))
    const minY = Math.min(...corners.map((point) => point[1]))
    const maxY = Math.max(...corners.map((point) => point[1]))
    covered += Math.max(0, maxX - minX) * Math.max(0, maxY - minY)
  }
  // 整页扫描件不做保留，否则夜间色调会等价于原色
  if (covered > pageArea * 0.82) return overlay

  const key = `${tone}:${source.width}x${source.height}:${rects.length}`
  if (overlay.dataset.renderKey === key) return overlay
  overlay.dataset.renderKey = key
  context.clearRect(0, 0, overlay.width, overlay.height)
  drawColorPreserve(context, source)

  for (const rect of rects) {
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height]
    ].map(([x, y]) => {
      const point = [x, y]
      Util.applyTransform(point, transform)
      return point
    })
    const minX = Math.min(...corners.map((point) => point[0]))
    const maxX = Math.max(...corners.map((point) => point[0]))
    const minY = Math.min(...corners.map((point) => point[1]))
    const maxY = Math.max(...corners.map((point) => point[1]))
    const left = Math.max(0, Math.floor(minX * scaleX))
    const top = Math.max(0, Math.floor(minY * scaleY))
    const right = Math.min(source.width, Math.ceil(maxX * scaleX))
    const bottom = Math.min(source.height, Math.ceil(maxY * scaleY))
    const width = right - left
    const height = bottom - top
    if (width < 8 || height < 8) continue
    context.drawImage(source, left, top, width, height, left, top, width, height)
  }
  return overlay
}
