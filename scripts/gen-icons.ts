/**
 * Render public/icon.svg to the PNG icons the manifest and iOS need (run once, commit the PNGs):
 *   npx tsx scripts/gen-icons.ts
 * Uses the Playwright Chromium already installed for the e2e tests (no extra dependency).
 */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pub = (p: string) => fileURLToPath(new URL(`../public/${p}`, import.meta.url))
const svg = readFileSync(pub('icon.svg'), 'utf8')

// The maskable icon keeps its artwork inside the central 80% safe zone, on a full-bleed background.
/** The full-bleed background of the maskable and Apple icons: the icon's own green (public/icon.svg). */
const BLEED = '#0bb363'
const targets: { file: string; size: number; maskable?: boolean }[] = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
]

const browser = await chromium.launch()
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } })
    const inner = t.maskable ? Math.round(t.size * 0.8) : t.size
    const bg = t.maskable ? BLEED : 'transparent'
    await page.setContent(
      `<html><body style="margin:0;width:${t.size}px;height:${t.size}px;display:grid;place-items:center;background:${bg}">
         <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
       </body></html>`,
    )
    await page.screenshot({ path: pub(t.file), omitBackground: !t.maskable })
    await page.close()
    console.log(`wrote public/${t.file}`)
  }
} finally {
  await browser.close()
}
