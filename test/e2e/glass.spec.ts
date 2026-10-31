import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeSession } from '../support/transcripts'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, sidebar } from './app'

// View › Always Show Glass: Blissful's Apple glass (a 10% white tint, 60% in
// light, a 12px blur, a short soft shadow, no rim), whatever Windows'
// transparency setting, with text on it that stays legible over the worst
// backdrop there is. Captures for a look: test-screens/glass/.
const dir = join(__dirname, '..', '..', 'test-screens', 'glass')

let n = 0
const id = () => `ffffffff-0000-4000-8000-${String(++n).padStart(12, '0')}`
const SESSIONS: FakeSession[] = [
  { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'phase 2 is ready, start with phase 3', title: 'Phase 3', updated: minutesAgo(3) },
  { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Commit and push', title: 'phase 2', updated: minutesAgo(33) },
  { id: id(), cwd: 'D:\\JS\\website', prompt: 'Rewrite the pricing page copy', title: 'Pricing page copy', updated: minutesAgo(60 * 50) }
]

type Rgb = [number, number, number]

/** WCAG 2 contrast between two sRGB colours. */
function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb) => {
    const [r, g, bl] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A computed rgb()/rgba() ink laid over a backdrop. */
function over(ink: string, back: Rgb): Rgb {
  const [r, g, b, a = 1] = ink.match(/[\d.]+/g)!.map(Number)
  return [r, g, b].map((v, i) => a * v + (1 - a) * back[i]) as Rgb
}

/** The colours on screen at these points, read back from a screenshot. */
async function colours(page: Page, points: [number, number][]): Promise<Rgb[]> {
  const png = (await page.screenshot({ scale: 'css' })).toString('base64')
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)] as [number, number, number])
    },
    { png, points }
  )
}

const style = (page: Page, selector: string, property: string, pseudo?: string) =>
  page.locator(selector).first().evaluate((el, [p, ps]) => getComputedStyle(el, ps).getPropertyValue(p), [property, pseudo ?? null] as const)

for (const theme of ['dark', 'light'] as const) {
  test(`Always Show Glass is Blissful's clear glass, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const { app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) })
    await setWindowSize(app, 1280, 800)
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    await page.evaluate(() => window.gloom!.runCommand('view.toggleGlass'))
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'on')
    await openGroup(page, 'Recent')
    await sessionRow(page, 'Phase 3', 'smart:recent').click()
    await page.mouse.move(900, 400)
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(dir, `clear-${theme}.png`) })

    // The material: the tooltip recipe on the sidebar and the toolbar's capsules.
    const tint = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.6)'
    const shadow = 'rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px'
    for (const surface of ['aside.glass', '.glass-capsule']) {
      expect(await style(page, surface, 'background-color')).toBe(tint)
      expect(await style(page, surface, 'backdrop-filter')).toBe('blur(12px)')
      expect(await style(page, surface, 'box-shadow')).toBe(shadow)
      expect(await style(page, surface, 'background-image', '::before')).toBe('none')
    }

    // The search field is the search bar's tint, a fill in the glass, lifted under the pointer.
    const field = page.locator('label:has(input[data-search])')
    const fieldFill = () => field.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await fieldFill()).toBe(tint)
    expect(await style(page, 'label:has(input[data-search])', 'backdrop-filter')).toBe('none')
    await field.hover()
    await expect.poll(fieldFill).toBe(theme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.75)')
    await page.mouse.move(900, 400)

    // Secondary ink on the sidebar, where the dusk behind it is at its lightest (the dark's ember) or darkest.
    const ink = await sidebar(page).locator('.session-row:not(.is-selected) .row-secondary').first().evaluate((el) => getComputedStyle(el).color)
    const foot = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Sessions"]')!
      const box = nav.getBoundingClientRect()
      return { left: box.left + 40, right: box.right - 16, top: nav.lastElementChild!.getBoundingClientRect().bottom + 8, bottom: box.bottom - 4 }
    })
    expect(foot.bottom - foot.top).toBeGreaterThan(100)
    const grid: [number, number][] = []
    for (let y = foot.top; y <= foot.bottom; y += 8) for (let x = foot.left; x <= foot.right; x += 16) grid.push([x, y])
    const sidebarWorst = Math.min(...(await colours(page, grid)).map((back) => contrast(over(ink, back), back)))
    expect(sidebarWorst).toBeGreaterThanOrEqual(4.5)

    // A popover's text over the worst backdrop: pure white behind it in the dark, pure black in the light.
    await page.getByRole('button', { name: 'Session info' }).click()
    const popup = page.getByRole('dialog', { name: 'Session Info' })
    await popup.waitFor()
    await page.waitForTimeout(400)
    const box = (await popup.boundingBox())!
    await page.evaluate(
      ({ box, fill }) => {
        const block = document.createElement('div')
        block.style.cssText = `position:fixed;left:${box.x - 40}px;top:${box.y - 20}px;width:${box.width + 80}px;height:${box.height + 40}px;z-index:40;background:${fill}`
        document.body.append(block)
      },
      { box, fill: theme === 'dark' ? '#ffffff' : '#000000' }
    )
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(dir, `clear-popover-worst-${theme}.png`) })
    const term = popup.locator('dt').first()
    const panelInk = await term.evaluate((el) => getComputedStyle(el).color)
    const t = (await term.boundingBox())!
    const d = (await popup.locator('dd').first().boundingBox())!
    const blanks: [number, number][] = [
      [box.x + 6, box.y + box.height / 2], // the panel, in its padding
      [box.x + box.width - 6, box.y + 24],
      [(t.x + t.width + d.x) / 2, t.y + t.height / 2] // the rows' card, between a term and its value
    ]
    for (const back of await colours(page, blanks)) expect(contrast(over(panelInk, back), back)).toBeGreaterThanOrEqual(4.5)

    // Off again: the glass Gloom had (opaque on a PC with transparency effects off).
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.gloom!.runCommand('view.toggleGlass'))
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'auto')
    expect(await style(page, 'aside.glass', 'backdrop-filter')).not.toBe('blur(12px)')
    await app.close()
  })
}
