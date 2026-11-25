import { expect, test } from './fixtures'

/** lib/outbox.ts OUTBOX_KEY (not imported: that module touches browser globals). */
const OUTBOX_KEY = 'flashcards.outbox.v1'

// Requests made while offline fail in the console; that is the point of this test.
test.use({ allowConsole: [/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/] })

test.describe('offline', () => {
  test('grades made offline wait in the outbox and are sent when back online', async ({ page, context, api, deck }) => {
    const cards = await api.readyCards(deck.id, 'Hund\nKatze\nHaus')
    for (const c of cards) await api.review(c.id, 1)
    const before = (await api.stats(deck.id)).reviewedToday

    await page.goto('/train')
    await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible()
    const outbox = () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]).length, OUTBOX_KEY)

    await context.setOffline(true)
    const grades = page.getByRole('group', { name: 'How well did you know it?' })
    for (const left of ['2 left · 1 reviewed', '1 left · 2 reviewed']) {
      await page.getByRole('button', { name: /Show answer/ }).click()
      await page.getByRole('button', { name: 'Change grade' }).click()
      await grades.getByRole('button', { name: /Easy/ }).click()
      await expect(page.getByText(left)).toBeVisible()
    }
    await expect.poll(outbox).toBe(2)
    expect((await api.stats(deck.id)).reviewedToday).toBe(before)

    await context.setOffline(false)
    await expect.poll(outbox, { timeout: 20_000 }).toBe(0)
    await expect.poll(async () => (await api.stats(deck.id)).reviewedToday).toBe(before + 2)
  })
})
