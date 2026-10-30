// Renders Gloom's app icon (src/shared/icon-art.ts) into build/icon.ico, which
// electron-builder puts on Gloom.exe, the installer and the uninstaller, and
// build/icon.png. Run after changing the drawing:
//   npx tsx scripts/make-icons.mts [--preview <file.png>]
// --preview also writes every size on a light and a dark taskbar, plus the
// smallest ones blown up 4x.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { iconSvg } from '../src/shared/icon-art.ts'

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const build = join(import.meta.dirname, '..', 'build')

function render(size: number) {
  const image = new Resvg(iconSvg({ size }), { fitTo: { mode: 'width', value: size } }).render()
  return { size, png: image.asPng(), rgba: straightAlpha(image.pixels) }
}

/** resvg hands back premultiplied RGBA; icon bitmaps want it straight. */
function straightAlpha(premultiplied: Buffer): Buffer {
  const out = Buffer.from(premultiplied)
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]
    if (a === 0 || a === 255) continue
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round((out[i + c] * 255) / a))
  }
  return out
}

/** A 32-bit BMP icon entry: header, bottom-up BGRA rows, and an empty AND mask. */
function bmpEntry(rgba: Buffer, size: number): Buffer {
  const header = Buffer.alloc(40)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = ((size - 1 - y) * size + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR bitmap and AND mask stacked
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(pixels.length + mask.length, 20)
  return Buffer.concat([header, pixels, mask])
}

/** Bitmap entries up to 128 px (what every Windows tool reads), PNG at 256. */
function ico(images: ReturnType<typeof render>[]): Buffer {
  const entries = images.map((i) => ({ size: i.size, data: i.size >= 256 ? i.png : bmpEntry(i.rgba, i.size) }))
  const directory = Buffer.alloc(6 + entries.length * 16)
  directory.writeUInt16LE(1, 2) // type: icon
  directory.writeUInt16LE(entries.length, 4)
  let offset = directory.length
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([directory, ...entries.map((e) => e.data)])
}

const images = SIZES.map(render)
writeFileSync(join(build, 'icon.ico'), ico(images))
writeFileSync(join(build, 'icon.png'), render(512).png)
console.log(`build/icon.ico (${SIZES.join(', ')} px) and build/icon.png (512 px)`)

const previewAt = process.argv.indexOf('--preview')
if (previewAt > 0) {
  const file = process.argv[previewAt + 1]
  const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`
  const strip = (y: number, bg: string) => {
    let x = 24
    const items = images.map(({ size, png }) => {
      const item = `<image href="${uri(png)}" x="${x}" y="${y + (280 - size) / 2}" width="${size}" height="${size}"/>`
      x += size + 24
      return item
    })
    return `<rect y="${y}" width="1100" height="280" fill="${bg}"/>${items.join('')}`
  }
  const zoomed = [16, 24, 32]
    .map((size, i) => `<image href="${uri(images.find((m) => m.size === size)!.png)}" x="${24 + i * 180}" y="584" width="${size * 4}" height="${size * 4}" image-rendering="optimizeSpeed"/>`)
    .join('')
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="740">${strip(0, '#f3f3f3')}${strip(280, '#202020')}<rect y="560" width="1100" height="180" fill="#e9e9ee"/>${zoomed}</svg>`
  writeFileSync(file, new Resvg(sheet).render().asPng())
  console.log(`preview: ${file}`)
}
