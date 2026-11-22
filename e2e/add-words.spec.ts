import { expect, test } from './fixtures'

test.describe('add new words', () => {
  test('Add 5 from the word list: all become ready with the fake AI, and a second Add 5 suggests different words', async ({ page, api, deck, shot }) => {
    for (const round of [1, 2]) {
      await page.goto('/add')
      await page.getByText('5', { exact: true }).click()
      await page.getByRole('button', { name: 'Add 5 words' }).click()
      await expect(page.getByText(/Added 5 words/).first()).toBeVisible()
      await expect.poll(async () => (await api.stats(deck.id)).ready).toBe(5 * round)
      if (round === 1) await shot('add-words-suggest-done')
    }
    const all = (await api.cards(deck.id, { limit: '100' })).cards.map((c) => c.inputTerm.toLowerCase())
    expect(new Set(all).size).toBe(10)
    expect(await api.stats(deck.id)).toMatchObject({ total: 10, pending: 0, failed: 0, duplicates: 0 })
  })
})
