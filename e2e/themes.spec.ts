import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { THEMES } from '../src/client/lib/themeInfo'
import { expect, expectAccessible, test } from './fixtures'

/** Per-theme screenshots of Home and Train go here (THEME_SHOTS_DIR, default test-results/themes). */
const SHOTS = path.resolve(process.env.THEME_SHOTS_DIR ?? 'test-results/themes')

const attrs = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    dark: document.documentElement.hasAttribute('data-dark'),
    color: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }))

test.describe('themes', () => {
  test('System follows the OS, the choice persists and applies before the app loads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/settings')
    const group = page.getByRole('group', { name: 'Theme' })
    await expect(group.getByRole('radio', { name: 'System' })).toBeChecked()
    expect(await attrs(page)).toEqual({ theme: 'system', dark: true, color: '#09090b' })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => attrs(page)).toEqual({ theme: 'system', dark: false, color: '#ffffff' })

    await group.locator('label', { hasText: 'Nord' }).click()
    await expect(group.getByRole('radio', { name: 'Nord' })).toBeChecked()
    expect(await attrs(page)).toEqual({ theme: 'nord', dark: true, color: '#2e3440' })
    expect(await page.evaluate(() => localStorage.getItem('flashy.theme.v1'))).toBe('nord')

    // theme-init.js runs before the module bundle: with the bundle blocked (a second tab, same
    // storage) the theme is still set.
    const bare = await page.context().newPage()
    await bare.route(/main\.tsx|\/assets\/.*\.js$/, (r) => r.abort())
    await bare.goto('/settings')
    expect(await attrs(bare)).toEqual({ theme: 'nord', dark: true, color: '#2e3440' })
    await bare.close()

    // Broken storage falls back to System.
    await page.evaluate(() => localStorage.setItem('flashy.theme.v1', 'neon'))
    await page.reload()
    await expect(page.getByRole('group', { name: 'Theme' }).getByRole('radio', { name: 'System' })).toBeChecked()
    expect((await attrs(page)).theme).toBe('system')
  })

  test('every theme passes axe on Settings, Home and Train', async ({ page, api, deck }) => {
    test.setTimeout(240_000)
    mkdirSync(SHOTS, { recursive: true })
    const cards = await api.readyCards(deck.id, 'Hund\nKatze\nHaus')
    for (const c of cards) await api.review(c.id, 1)
    await api.updateSettings({ studyDirection: 'source-target' })

    for (const t of THEMES) {
      await page.goto('/settings')
      await page.getByRole('group', { name: 'Theme' }).locator('label', { has: page.getByRole('radio', { name: t.label, exact: true }) }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', t.id)
      await expectAccessible(page, `settings (${t.id})`)
      await page.screenshot({ path: path.join(SHOTS, `${t.id}-settings.png`), fullPage: true, animations: 'disabled', caret: 'hide' })

      await page.goto('/')
      await expect(page.getByRole('link', { name: /Train · 3 due/ })).toBeVisible()
      await expectAccessible(page, `home (${t.id})`)
      await page.screenshot({ path: path.join(SHOTS, `${t.id}-home.png`), animations: 'disabled', caret: 'hide' })

      await page.goto('/train')
      const answer = page.getByLabel('Type the German word')
      await expect(answer).toBeFocused()
      await expectAccessible(page, `train answering (${t.id})`)
      await answer.fill('der Quatsch')
      await answer.press('Enter')
      await expect(page.getByTestId('auto-grade')).toHaveText(/^Again/)
      await expectAccessible(page, `train wrong (${t.id})`)
      await page.screenshot({ path: path.join(SHOTS, `${t.id}-train.png`), animations: 'disabled', caret: 'hide' })
      await page.getByRole('button', { name: 'Change grade' }).click()
      await expect(page.getByRole('group', { name: 'How well did you know it?' })).toBeVisible()
      await expectAccessible(page, `train grades (${t.id})`)
      await page.screenshot({ path: path.join(SHOTS, `${t.id}-train-grades.png`), animations: 'disabled', caret: 'hide' })
    }
  })
})
