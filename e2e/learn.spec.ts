import type { Page } from '@playwright/test'
import { expect, expectAccessible, test } from './fixtures'

/** Steps through the learn session (intro -> quick check -> Show answer, Easy) until the summary shows. */
async function learnAll(page: Page) {
  const summary = page.getByText('Nice work')
  const next = page.getByRole('button', { name: /Show the word|Got it/ })
  const show = page.getByRole('button', { name: 'Show answer' })
  const easy = page.getByRole('group', { name: 'How well did you know it?' }).getByRole('button', { name: /Easy/ })
  for (let i = 0; i < 40; i++) {
    await expect(next.or(show).or(easy).or(summary).first()).toBeVisible()
    if (await summary.isVisible()) return
    if (await next.isVisible()) {
      await expect(page.getByText('New word')).toBeVisible()
      await page.keyboard.press('ArrowRight')
    } else if (await show.isVisible()) {
      await expect(page.getByText('Quick check')).toBeVisible()
      await show.click()
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

  test('intro steps with the arrow keys, back to the previous card, typed quick check', async ({ page, api, deck, shot }) => {
    await api.readyCards(deck.id, 'Hund\nKatze')
    await page.goto('/learn')
    const card = page.getByTestId('intro-card')
    const step = page.getByTestId('intro-step')

    // Step A: the English word; ArrowRight reveals the German word, then moves to the next card.
    await expect(step).toHaveText('Step 1 of 2')
    await expect(card).toContainText('dog')
    await expect(card).not.toContainText('der Hund')
    await expectAccessible(page, 'learn intro step 1')
    await page.keyboard.press('ArrowRight')
    await expect(step).toHaveText('Step 2 of 2')
    await expect(card).toContainText('der Hund')
    await expect(card).toContainText('Plural: die Hunde')
    await expectAccessible(page, 'learn intro step 2')
    await page.keyboard.press('ArrowRight')
    await expect(step).toHaveText('Step 1 of 2')
    await expect(card).toContainText('cat')

    // ArrowLeft goes back to the previous card's second step, then to its first.
    await page.keyboard.press('ArrowLeft')
    await expect(step).toHaveText('Step 2 of 2')
    await expect(card).toContainText('der Hund')
    await page.keyboard.press('ArrowLeft')
    await expect(step).toHaveText('Step 1 of 2')
    await expect(card).toContainText('dog')
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled()

    // Through both intros (buttons this time), then the quick check with a typed answer.
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /Show the word/ }).click()
      await page.getByRole('button', { name: /Got it/ }).click()
    }
    await expect(page.getByText('Quick check')).toBeVisible()
    const front = (await page.getByTestId('study-card').innerText()).trim()
    const answer = front.startsWith('der Hund') ? 'dog' : 'cat'
    await page.getByLabel('Type the English meaning').fill(answer)
    await expect(page.getByTestId('verdict')).toHaveText('✓ Correct')
    await shot('learn-check-correct')
    await expectAccessible(page, 'learn quick check revealed')
  })

  test('the verb table for gehen', async ({ page, api, deck, shot }) => {
    await api.readyCards(deck.id, 'gehen')
    await page.goto('/learn')
    await page.getByRole('button', { name: /Show the word/ }).click()
    const table = page.getByRole('table', { name: 'Verb forms' })
    await expect(table).toBeVisible()
    await expect(table.getByRole('row', { name: /ich/ })).toContainText('gehe')
    await expect(table.getByRole('row', { name: /ich/ })).toContainText('ging')
    await expect(table.getByRole('row', { name: /^du/ })).toContainText('gehst')
    await expect(page.getByText('Perfect: ist gegangen')).toBeVisible()
    await shot('learn-verb-table')
    await expectAccessible(page, 'learn verb table')
  })
})
