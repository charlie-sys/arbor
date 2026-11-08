import type { RenderBlock, RenderRequest } from '@shared/types'
import { t } from '@shared/i18n'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t("译文底图加载失败")))
    image.src = src
  })
}

function luminance(color: number[]): number {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
}

function medianColor(samples: number[][]): { color: string; isDark: boolean } {
  if (!samples.length) return { color: 'rgb(255,255,255)', isDark: false }
  const sorted = [...samples].sort((a, b) => luminance(a) - luminance(b))
  const middle = sorted[Math.floor(sorted.length / 2)]
  return {
    color: `rgb(${middle[0]}, ${middle[1]}, ${middle[2]})`,
    isDark: luminance(middle) < 120
  }
}

function sampleBackground(
  data: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number
): { color: string; isDark: boolean } {
  const pad = 4
  const left = Math.max(0, x - pad)
  const right = Math.min(canvasWidth - 1, x + width + pad)
  const top = Math.max(0, y - pad)
  const bottom = Math.min(canvasHeight - 1, y + height + pad)
  const points: [number, number][] = []
  const stepX = Math.max(1, Math.floor((right - left) / 10))
  const stepY = Math.max(1, Math.floor((bottom - top) / 8))
  for (let px = left; px <= right; px += stepX) {
    points.push([px, top], [px, bottom])
  }
  for (let py = top; py <= bottom; py += stepY) {
    points.push([left, py], [right, py])
  }
  const samples = points.map(([px, py]) => {
    const index = (py * canvasWidth + px) * 4
    return [data[index], data[index + 1], data[index + 2]]
  })
  return medianColor(samples)
}

function tokenize(text: string): string[] {
  const units: string[] = []
  let buffer = ''
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
      if (buffer) {
        units.push(buffer)
        buffer = ''
      }
      units.push(char)
    } else if (char === ' ') {
      buffer += char
      units.push(buffer)
      buffer = ''
    } else if (char === '\n') {
      if (buffer) {
        units.push(buffer)
        buffer = ''
      }
      units.push('\n')
    } else {
      buffer += char
    }
  }
  if (buffer) units.push(buffer)
  return units
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const units = tokenize(text)
  const lines: string[] = []
  let line = ''
  for (const unit of units) {
    if (unit === '\n') {
      lines.push(line.trimEnd())
      line = ''
      continue
    }
    const candidate = line + unit
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line.trimEnd())
      line = unit.trimStart()
    } else {
      line = candidate
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

function drawBlock(
  context: CanvasRenderingContext2D,
  imageData: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  block: RenderBlock
): void {
  const text = block.text.trim()
  if (!text) return
  const x = Math.max(0, Math.round(block.x))
  const y = Math.max(0, Math.round(block.y))
  const width = Math.min(canvasWidth - x, Math.round(block.width))
  const height = Math.min(canvasHeight - y, Math.round(block.height))
  if (width < 4 || height < 4) return

  const background = sampleBackground(imageData, canvasWidth, canvasHeight, x, y, width, height)
  context.fillStyle = background.color
  context.fillRect(x - 3, y - 3, width + 6, height + 6)

  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()
  context.fillStyle = background.isDark ? '#f8fafc' : '#1f2937'
  context.textBaseline = 'top'

  let fontSize = Math.max(8, Math.min(64, Math.round(block.fontSize) || 14))
  let lines: string[] = []
  for (; fontSize >= 7; fontSize--) {
    context.font = `${fontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`
    lines = wrapText(context, text, width - 2)
    const lineHeight = fontSize * 1.2
    if (lines.length * lineHeight <= height * 1.15 || fontSize === 7) break
  }

  const lineHeight = fontSize * 1.2
  let drawY = y + Math.max(0, (height - lines.length * lineHeight) / 2)
  const maxLines = Math.max(1, Math.floor(height / lineHeight))
  for (const line of lines.slice(0, maxLines)) {
    context.fillText(line, x + 1, drawY)
    drawY += lineHeight
  }
  context.restore()
}

export async function renderTranslatedImage(request: RenderRequest): Promise<string> {
  const image = await loadImage(request.imageDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t("无法创建画布"))
  context.drawImage(image, 0, 0)
  const snapshot = context.getImageData(0, 0, canvas.width, canvas.height).data

  for (const block of request.blocks) {
    drawBlock(context, snapshot, canvas.width, canvas.height, block)
  }
  return canvas.toDataURL('image/png')
}
