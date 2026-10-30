// Turns Gloom's cloud, update.png at the repo root, into the files the app
// uses: the app icon, the cloud on a violet tile, into build/icon.ico, which
// electron-builder puts on Gloom.exe, the installer and the uninstaller, and
// build/icon.png; and the cloud on its own into
// src/renderer/src/assets/update.png for the update screen. Run after
// changing the cloud or the tile:
//   npx tsx scripts/make-icons.mts [--preview <file.png>]
// --preview also writes every size on a light and a dark taskbar, plus the
// smallest ones blown up 4x.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const root = join(import.meta.dirname, '..')

// The tile under the cloud: a rounded square edge to edge, since Windows
// puts app icons on the taskbar with no plate of their own, in a violet light
// enough to stand out on a dark taskbar as well as a light one. #a78bfa at
// the top left to #6d28d9 at the bottom right.
const TILE = { from: [167, 139, 250], to: [109, 40, 217], corner: 0.22 }
/** The cloud's image, as a share of the tile's width. */
const CLOUD_SCALE = 0.84

/** Square artwork in premultiplied linear light. */
interface Art {
  size: number
  pixels: Float32Array
}

/** The artwork, decoded by resvg. */
function decode(file: string): Art {
  const png = readFileSync(file)
  if (png.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} isn't a PNG`)
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  if (width !== height || width < 256) throw new Error(`${file} is ${width}×${height} px; the icon needs a square of at least 256 px`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${width}" image-rendering="optimizeSpeed"/></svg>`
  return { size: width, pixels: linearize(new Resvg(svg).render().pixels) }
}

// Sizes are averaged in linear light, so the glowing details keep their
// brightness as they shrink instead of going dim.
const toLinear = Float32Array.from({ length: 256 }, (_, i) => (i <= 10 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4))
const toSrgb = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)

/** Premultiplied 8-bit sRGB to premultiplied linear light. */
function linearize(pixels: Buffer): Float32Array {
  const out = new Float32Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255
    out[i + 3] = a
    if (a === 0) continue
    for (let c = 0; c < 3; c++) out[i + c] = toLinear[Math.min(255, Math.round(pixels[i + c] / a))] * a
  }
  return out
}

const lanczos = (x: number) => (x === 0 ? 1 : Math.abs(x) >= 3 ? 0 : (3 * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / 3)) / (Math.PI * Math.PI * x * x))

/** For each pixel along one axis of the new size, the source pixels it reads and their weights. */
function taps(from: number, to: number) {
  const scale = from / to
  const stretch = Math.max(scale, 1)
  return Array.from({ length: to }, (_, i) => {
    const center = (i + 0.5) * scale
    const first = Math.max(0, Math.floor(center - 3 * stretch))
    const last = Math.min(from - 1, Math.ceil(center + 3 * stretch))
    const weights = Array.from({ length: last - first + 1 }, (_, k) => lanczos((first + k + 0.5 - center) / stretch))
    const sum = weights.reduce((a, b) => a + b, 0)
    return { first, weights: weights.map((w) => w / sum) }
  })
}

/** A Lanczos-3 resize of square premultiplied RGBA, rows then columns. */
function resize(src: Float32Array, from: number, to: number): Float32Array {
  const t = taps(from, to)
  const rows = new Float32Array(from * to * 4)
  for (let y = 0; y < from; y++) {
    for (let x = 0; x < to; x++) {
      const { first, weights } = t[x]
      const o = (y * to + x) * 4
      for (let k = 0; k < weights.length; k++) {
        const i = (y * from + first + k) * 4
        for (let c = 0; c < 4; c++) rows[o + c] += src[i + c] * weights[k]
      }
    }
  }
  const out = new Float32Array(to * to * 4)
  for (let y = 0; y < to; y++) {
    const { first, weights } = t[y]
    for (let x = 0; x < to; x++) {
      const o = (y * to + x) * 4
      for (let k = 0; k < weights.length; k++) {
        const i = ((first + k) * to + x) * 4
        for (let c = 0; c < 4; c++) out[o + c] += rows[i + c] * weights[k]
      }
    }
  }
  return out
}

/** Back to straight 8-bit sRGB, clamping the filter's overshoot. */
function toRgba(linear: Float32Array): Buffer {
  const out = Buffer.alloc(linear.length)
  for (let i = 0; i < linear.length; i += 4) {
    const a = Math.min(1, Math.max(0, linear[i + 3]))
    out[i + 3] = Math.round(a * 255)
    if (out[i + 3] === 0) continue
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(toSrgb(Math.min(1, Math.max(0, linear[i + c] / a))))
  }
  return out
}

/** An 8-bit RGBA PNG, every row Paeth-filtered. */
function png(rgba: Buffer, size: number): Buffer {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    const at = y * (stride + 1)
    raw[at] = 4
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x
      const left = x >= 4 ? rgba[i - 4] : 0
      const up = y > 0 ? rgba[i - stride] : 0
      const corner = x >= 4 && y > 0 ? rgba[i - stride - 4] : 0
      const p = left + up - corner
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
      raw[at + 1 + x] = rgba[i] - (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'latin1')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6], 8) // 8 bits per channel, RGBA
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
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

interface Rendered {
  size: number
  rgba: Buffer
  png: Buffer
}

/** Bitmap entries up to 128 px (what every Windows tool reads), PNG at 256. */
function ico(images: Rendered[]): Buffer {
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

/** The app icon: the cloud, centred on the tile. */
function onTile(cloud: Art): Art {
  const n = Math.round(cloud.size / CLOUD_SCALE)
  const [from, to] = [TILE.from, TILE.to].map((rgb) => rgb.map((v) => toLinear[v]))
  const radius = TILE.corner * n
  const pixels = new Float32Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Distance outside the rounded square, for an antialiased edge.
      const dx = Math.max(Math.abs(x + 0.5 - n / 2) - (n / 2 - radius), 0)
      const dy = Math.max(Math.abs(y + 0.5 - n / 2) - (n / 2 - radius), 0)
      const cover = Math.min(1, Math.max(0, 0.5 - (Math.hypot(dx, dy) - radius)))
      const t = (x + y + 1) / (2 * n)
      const i = (y * n + x) * 4
      for (let c = 0; c < 3; c++) pixels[i + c] = (from[c] * (1 - t) + to[c] * t) * cover
      pixels[i + 3] = cover
    }
  }
  const at = Math.round((n - cloud.size) / 2)
  for (let y = 0; y < cloud.size; y++) {
    for (let x = 0; x < cloud.size; x++) {
      const s = (y * cloud.size + x) * 4
      const d = ((y + at) * n + x + at) * 4
      const under = 1 - cloud.pixels[s + 3]
      for (let c = 0; c < 4; c++) pixels[d + c] = cloud.pixels[s + c] + pixels[d + c] * under
    }
  }
  return { size: n, pixels }
}

function render(art: Art, size: number): Rendered {
  const rgba = toRgba(resize(art.pixels, art.size, size))
  return { size, rgba, png: png(rgba, size) }
}

const cloud = decode(join(root, 'update.png'))
const icon = onTile(cloud)
const images = SIZES.map((size) => render(icon, size))
const screen = join(root, 'src', 'renderer', 'src', 'assets', 'update.png')
mkdirSync(dirname(screen), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico(images))
writeFileSync(join(root, 'build', 'icon.png'), render(icon, 512).png)
writeFileSync(screen, render(cloud, 256).png)
console.log(`build/icon.ico (${SIZES.join(', ')} px), build/icon.png (512 px) and src/renderer/src/assets/update.png (256 px)`)

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
