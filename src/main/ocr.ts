import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface OcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrResult {
  language: string
  width: number
  height: number
  lines: OcrLine[]
}

export interface LayoutBlock extends OcrLine {
  id: number
  fontSize: number
}

const OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$path = '__IMAGE_PATH__'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') })[0]
function Await($op, $type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function Read-Lines($engine, $bitmap) {
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $items = @()
  foreach ($line in $result.Lines) {
    $x = 999999; $y = 999999; $right = 0; $bottom = 0
    foreach ($word in $line.Words) {
      $rect = $word.BoundingRect
      if ($rect.X -lt $x) { $x = $rect.X }
      if ($rect.Y -lt $y) { $y = $rect.Y }
      if (($rect.X + $rect.Width) -gt $right) { $right = $rect.X + $rect.Width }
      if (($rect.Y + $rect.Height) -gt $bottom) { $bottom = $rect.Y + $rect.Height }
    }
    $items += [pscustomobject]@{ text = $line.Text; x = [int]$x; y = [int]$y; width = [int]($right - $x); height = [int]($bottom - $y) }
  }
  return ,$items
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = $null
try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() } catch { $engine = $null }
if (-not $engine) {
  foreach ($lang in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    if ($lang.LanguageTag -like 'en*') { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang); break }
  }
}
if (-not $engine) { Write-Output '{"error":"NO_ENGINE"}'; exit 0 }
$language = $engine.RecognizerLanguage.LanguageTag
$lines = Read-Lines $engine $bitmap
$joined = ($lines | ForEach-Object { $_.text }) -join ' '
if ($joined -notmatch '[\\u4e00-\\u9fff]') {
  foreach ($lang in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    if ($lang.LanguageTag -like 'en*') {
      $enEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
      if ($enEngine) {
        $enLines = Read-Lines $enEngine $bitmap
        $enJoined = ($enLines | ForEach-Object { $_.text }) -join ' '
        if ($enJoined.Length -ge ($joined.Length - 2)) { $lines = $enLines; $language = $lang.LanguageTag }
      }
      break
    }
  }
}
$out = [pscustomobject]@{ language = $language; width = $decoder.PixelWidth; height = $decoder.PixelHeight; lines = @($lines) }
$out | ConvertTo-Json -Compress -Depth 5
`

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

export async function ocrImage(filePath: string): Promise<OcrResult | null> {
  try {
    const script = OCR_SCRIPT.replace('__IMAGE_PATH__', escapePowerShellSingleQuoted(filePath))
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 40000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }
    )
    const text = stdout.replace(/^\uFEFF/, '').trim()
    const start = text.indexOf('{')
    if (start < 0) return null
    const parsed = JSON.parse(text.slice(start)) as OcrResult & { error?: string }
    if (parsed.error) {
      console.warn('OCR engine unavailable:', parsed.error)
      return null
    }
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return null
    return parsed
  } catch (err) {
    console.warn('OCR failed:', (err as Error).message)
    return null
  }
}

function hasText(text: string): boolean {
  return /[A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)
}

export function groupLines(lines: OcrLine[]): LayoutBlock[] {
  const usable = lines
    .filter((line) => line.text.trim() && hasText(line.text) && line.width > 2 && line.height > 2)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const groups: OcrLine[][] = []
  for (const line of usable) {
    const group = groups[groups.length - 1]
    const previous = group?.[group.length - 1]
    if (group && previous) {
      const overlap =
        Math.min(previous.x + previous.width, line.x + line.width) - Math.max(previous.x, line.x)
      const minWidth = Math.min(previous.width, line.width)
      const verticalGap = line.y - (previous.y + previous.height)
      const nearLeft = Math.abs(line.x - previous.x) < Math.max(12, previous.height * 1.2)
      if (verticalGap <= Math.max(6, previous.height * 0.85) && overlap > minWidth * 0.3 && nearLeft) {
        group.push(line)
        continue
      }
    }
    groups.push([line])
  }

  const blocks: LayoutBlock[] = []
  for (const group of groups) {
    const x = Math.min(...group.map((line) => line.x))
    const y = Math.min(...group.map((line) => line.y))
    const right = Math.max(...group.map((line) => line.x + line.width))
    const bottom = Math.max(...group.map((line) => line.y + line.height))
    const text = group.map((line) => line.text.trim()).join(' ')
    const fontSize = Math.round(group.reduce((sum, line) => sum + line.height, 0) / group.length)
    blocks.push({
      id: blocks.length + 1,
      text,
      x,
      y,
      width: right - x,
      height: bottom - y,
      fontSize
    })
  }
  return blocks
}
