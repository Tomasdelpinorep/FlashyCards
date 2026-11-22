import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/** Steps through the learn session (intro -> quick check -> grade Easy) until the summary shows. */
async function learnAll(page: Page) {
  const summary = page.getByText('Nice work')
  const gotIt = page.getByRole('button', { name: 'Got it' })
  const show = page.getByRole('button', { name: /Show answer/ })
  const easy = page.getByRole('group', { name: 'How well did you know it?' }).getByRole('button', { name: /Easy/ })
  for (let i = 0; i < 30; i++) {
    await expect(gotIt.or(show).or(easy).or(summary).first()).toBeVisible()
    if (await summary.isVisible()) return
    if (await gotIt.isVisible()) {
      await expect(page.getByText('New word')).toBeVisible()
      await gotIt.click()
    } else if (await show.isVisible()) {
      await expect(page.getByText('Quick check')).toBeVisible()
      await page.keyboard.press('Space')
    } else {
      await expect(easy).toBeEnabled()
      await page.keyboard.press('4')
    }
  }
  throw new Error('learn session did not finish')
}

test.describe('learn new', () => {
  test('intro, quick check and summary, then the daily limit', async ({ page, api, deck, shot }) => {
    await api.updateDeck(deck.id, { settings: { dailyNewLimit: 2 } })
    await api.readyCards(deck.id, 'Hund\nKatze\nHaus')

    await page.goto('/')
    await page.getByRole('link', { name: /Learn new · 3 ready/ }).click()
    await expect(page).toHaveURL(/\/learn$/)
    await expect(page.getByText('New word')).toBeVisible()
    await shot('learn-intro')
    await learnAll(page)
    await expect(page.getByRole('status').filter({ hasText: 'Nice work' })).toContainText('2 words learned')
    await shot('learn-summary')

    await expect.poll(async () => (await api.stats(deck.id)).newToday).toBe(2)
    await page.goto('/')
    await expect(page.getByRole('link', { name: /Daily limit reached · Learn 5 more/ })).toBeVisible()
    await page.goto('/learn')
    await expect(page.getByText('Daily limit reached')).toBeVisible()
    await page.getByRole('button', { name: 'Learn 5 more' }).click()
    await learnAll(page)
    await expect.poll(async () => (await api.stats(deck.id)).new).toBe(0)
  })
})
