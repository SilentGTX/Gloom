// Gloom's app icon, drawn as SVG at any size: an indigo dusk tile, Apple's
// squircle edge to edge (Windows shows app icons full bleed), with white
// sparkles. Small sizes get a simpler drawing, one bigger sparkle, since the
// little ones turn to specks. scripts/make-icons.mts renders it into
// build/icon.ico; the update screen draws it inline and animates the sparkles.

export type IconDetail = 'full' | 'medium' | 'small'

export function iconDetailFor(size: number): IconDetail {
  return size <= 24 ? 'small' : size <= 40 ? 'medium' : 'full'
}

/** The drawing's own canvas; every size is this, scaled. */
const CANVAS = 1024
const n1 = (n: number) => Number(n.toFixed(1))

/** Apple's icon outline: a superellipse, the square with continuous corners. */
function squircle(exponent = 5, steps = 144): string {
  const r = CANVAS / 2
  const points: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const [c, s] = [Math.cos(t), Math.sin(t)]
    points.push(`${n1(r + r * Math.sign(c) * Math.abs(c) ** (2 / exponent))} ${n1(r + r * Math.sign(s) * Math.abs(s) ** (2 / exponent))}`)
  }
  return `M${points.join('L')}Z`
}

/** A four-point sparkle with concave sides; a smaller `pinch` makes it more slender. */
export function sparklePath(cx: number, cy: number, r: number, pinch: number): string {
  const p = r * pinch
  return (
    `M${n1(cx)} ${n1(cy - r)}` +
    `Q${n1(cx + p)} ${n1(cy - p)} ${n1(cx + r)} ${n1(cy)}` +
    `Q${n1(cx + p)} ${n1(cy + p)} ${n1(cx)} ${n1(cy + r)}` +
    `Q${n1(cx - p)} ${n1(cy + p)} ${n1(cx - r)} ${n1(cy)}` +
    `Q${n1(cx - p)} ${n1(cy - p)} ${n1(cx)} ${n1(cy - r)}Z`
  )
}

interface Sparkle {
  name: 'big' | 'top' | 'low'
  cx: number
  cy: number
  r: number
  pinch: number
}

// The lucide "sparkles" arrangement: one big sparkle, a small one up to the
// right, a smaller one down to the left, by the dusk's warm glow.
const LAYOUT: Record<IconDetail, Sparkle[]> = {
  full: [
    { name: 'big', cx: 448, cy: 576, r: 304, pinch: 0.17 },
    { name: 'top', cx: 756, cy: 276, r: 118, pinch: 0.2 },
    { name: 'low', cx: 236, cy: 820, r: 66, pinch: 0.22 }
  ],
  medium: [
    { name: 'big', cx: 470, cy: 560, r: 340, pinch: 0.19 },
    { name: 'top', cx: 790, cy: 250, r: 140, pinch: 0.22 }
  ],
  small: [{ name: 'big', cx: 512, cy: 512, r: 392, pinch: 0.24 }]
}

/**
 * The icon as an SVG string. `id` prefixes its gradient and filter ids, so
 * two copies on one page don't collide. Each sparkle is a `.sparkle-<name>`
 * group, for the update screen to animate.
 */
export function iconSvg({ size, detail = iconDetailFor(size), id = 'gloom-icon' }: { size: number; detail?: IconDetail; id?: string }): string {
  const ref = (name: string) => `${id}-${name}`
  const tile = squircle()
  const full = detail === 'full'
  const sparkles = LAYOUT[detail]
  const big = sparkles[0]
  const star = (s: Sparkle) =>
    `<path d="${sparklePath(s.cx, s.cy, s.r, s.pinch)}" fill="url(#${ref('star')})" stroke="url(#${ref('star')})" stroke-width="${n1(s.r * 0.03)}" stroke-linejoin="round"/>`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${size}" height="${size}">`,
    '<defs>',
    `<clipPath id="${ref('tile')}"><path d="${tile}"/></clipPath>`,
    `<linearGradient id="${ref('bg')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9093f9"/><stop offset="0.5" stop-color="#5b5bd6"/><stop offset="1" stop-color="#3a2fa6"/></linearGradient>`,
    `<radialGradient id="${ref('ember')}" cx="0.1" cy="1" r="0.7"><stop offset="0" stop-color="#ffae8a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffae8a" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="${ref('sheen')}" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${ref('rim')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0.22"/></linearGradient>`,
    `<linearGradient id="${ref('star')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e4e2ff"/></linearGradient>`,
    `<filter id="${ref('lift')}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#1e1566" flood-opacity="0.35"/></filter>`,
    `<filter id="${ref('glow')}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>`,
    '</defs>',
    `<path d="${tile}" fill="url(#${ref('bg')})"/>`,
    `<path d="${tile}" fill="url(#${ref('ember')})"/>`,
    `<path d="${tile}" fill="url(#${ref('sheen')})"/>`,
    // The rim: light catching the edge, the inner half of a stroke clipped to the tile.
    full ? `<path d="${tile}" fill="none" stroke="url(#${ref('rim')})" stroke-width="20" clip-path="url(#${ref('tile')})"/>` : '',
    full ? `<path class="sparkle-glow" d="${sparklePath(big.cx, big.cy, big.r * 1.08, big.pinch)}" fill="#fff" opacity="0.4" filter="url(#${ref('glow')})"/>` : '',
    `<g${detail === 'small' ? '' : ` filter="url(#${ref('lift')})"`}>`,
    ...sparkles.map((s) => `<g class="sparkle sparkle-${s.name}">${star(s)}</g>`),
    '</g>',
    '</svg>'
  ].join('')
}
