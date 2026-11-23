import { expect, test } from './fixtures'

test.describe('add new words', () => {
  test('Add 5 from the word list: all ready at once from the dictionary, and a second Add 5 suggests different words', async ({ page, api, deck, shot }) => {
    for (const round of [1, 2]) {
      await page.goto('/add')
      await page.getByText('5', { exact: true }).click()
      const response = page.waitForResponse((r) => r.url().endsWith('/suggest'))
      await page.getByRole('button', { name: 'Add 5 words' }).click()
      // Suggestions come only from the curated dictionary: ready at insert, nothing to look up.
      expect(await (await response).json()).toMatchObject({ added: 5, ready: 5, pending: 0 })
      await expect(page.getByText(/Added 5 words/).first()).toBeVisible()
      await expect.poll(async () => (await api.stats(deck.id)).ready).toBe(5 * round)
      if (round === 1) await shot('add-words-suggest-done')
    }
    const all = (await api.cards(deck.id, { limit: '100' })).cards.map((c) => c.inputTerm.toLowerCase())
    expect(new Set(all).size).toBe(10)
    expect(await api.stats(deck.id)).toMatchObject({ total: 10, pending: 0, failed: 0, duplicates: 0 })
    // The skip list (ich, sie, der, du, ...) is never suggested.
    expect(all.filter((w) => ['ich', 'sie', 'der', 'du', 'es', 'wir', 'er', 'ein'].includes(w))).toEqual([])
  })

  test('a word that needs a meaning: fill the form, then it shows in Learn', async ({ page, api, deck, shot }) => {
    // "asdfgh" is not a word for the (fake) AI, so it ends as failed, like a dictionary miss without AI.
    await api.readyCards(deck.id, 'asdfgh')
    await page.goto('/words')
    const row = page.getByRole('listitem').filter({ hasText: 'asdfgh' })
    await expect(row).toContainText('Needs meaning')
    await row.getByRole('link').click()
    const form = page.getByRole('form', { name: 'Add the meaning' })
    await expect(form).toBeVisible()
    await form.getByLabel('German word').fill('die Zwetschge')
    await form.getByLabel('English meaning').fill('plum')
    await form.getByLabel('Example sentence (optional)').fill('Die [[Zwetschge]] ist reif.')
    await form.getByLabel('Its translation (optional)').fill('The [[plum]] is ripe.')
    await shot('card-detail-meaning-form')
    await form.getByRole('button', { name: 'Save meaning' }).click()
    await expect(page.getByRole('main').getByRole('paragraph').filter({ hasText: /^plum$/ })).toBeVisible()
    await expect(form).toHaveCount(0)
    expect(await api.stats(deck.id)).toMatchObject({ ready: 1, failed: 0 })

    await page.goto('/learn')
    await expect(page.getByText('New word')).toBeVisible()
    await expect(page.getByRole('main')).toContainText('The plum is ripe.')
    await page.getByRole('button', { name: 'Show the word' }).click()
    await expect(page.getByRole('main')).toContainText('die Zwetschge')
  })
})
