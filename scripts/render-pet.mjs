import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { STATES } from './pet/states.mjs'
import { renderSvg } from './pet/art.mjs'

const OUT = path.resolve('src/renderer/public/pet')
const WORK = path.resolve('assets/pet-src')
const W = 400
const H = 460

async function renderState(name, def) {
  const dir = path.join(OUT, name)
  await mkdir(dir, { recursive: true })
  const thumbs = []
  for (let i = 0; i < def.frames.length; i++) {
    const svg = renderSvg(def.frames[i])
    const png = await sharp(Buffer.from(svg), { density: 288 })
      .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(path.join(dir, `${i}.png`), png)
    thumbs.push(png)
  }
  return thumbs
}

await mkdir(OUT, { recursive: true })
await mkdir(WORK, { recursive: true })
const manifest = {}
const firsts = []
for (const [name, def] of Object.entries(STATES)) {
  const thumbs = await renderState(name, def)
  manifest[name] = { label: def.label, fps: def.fps, frames: def.frames.length }
  firsts.push(thumbs[0])
  console.log(`rendered ${name}: ${thumbs.length} frames`)
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))

const cellW = 220
const cellH = 260
const sheet = sharp({
  create: { width: cellW * 4, height: cellH * 2, channels: 4, background: { r: 244, g: 237, b: 226, alpha: 1 } }
})
const composites = firsts.map((buf, i) => ({
  input: buf,
  left: (i % 4) * cellW,
  top: Math.floor(i / 4) * cellH,
  width: 200,
  height: 230
}))
await sheet.composite(composites).png().toFile(path.join(WORK, 'contact.png'))
console.log('wrote', path.join(WORK, 'contact.png'))
