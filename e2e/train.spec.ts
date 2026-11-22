import { expect, test } from './fixtures'

test.describe('train', () => {
  test('empty state when nothing has been studied', async ({ page, api, deck }) => {
    await api.readyCards(deck.id, 'Hund')
    await page.goto('/train')
    await expect(page.getByText('All done', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing to review yet. Words you study will show up here.')).toBeVisible()
  })

  test('direction toggle, grading with keys and buttons, due count drops', async ({ page, api, deck, shot }) => {
    const cards = await api.readyCards(deck.id, 'Hund\nKatze\nHaus')
    for (const c of cards) await api.review(c.id, 1) // Learning, due within the learn-ahead window
    await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(3)

    await page.goto('/')
    await page.getByRole('link', { name: /Train · 3 due/ }).click()
    const card = page.locator('section[aria-live="polite"]')
    const direction = page.getByRole('radiogroup', { name: 'Direction' })
    await expect(direction.getByRole('radio', { name: 'DE→EN' })).toHaveAttribute('aria-checked', 'true')
    await expect(card).toContainText(/der Hund|die Katze|das Haus/)

    // EN -> DE: the front shows the translation; the choice is saved to the user's settings.
    await direction.getByRole('radio', { name: 'EN→DE' }).click()
    await expect(direction.getByRole('radio', { name: 'EN→DE' })).toHaveAttribute('aria-checked', 'true')
    await expect(card).toContainText(/^(dog|cat|house)/)
    await expect.poll(async () => (await api.me()).user.settings.studyDirection).toBe('source-target')
    await shot('train-front-source-target')

    // Keyboard: Space flips, 4 = Easy.
    await page.keyboard.press('Space')
    const grades = page.getByRole('group', { name: 'How well did you know it?' })
    await expect(grades.getByRole('button', { name: /Easy/ })).toBeEnabled()
    await shot('train-back')
    await page.keyboard.press('4')
    await expect(page.getByText('2 left · 1 reviewed')).toBeVisible()
    await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(2)

    // Buttons: Show answer, then Easy.
    for (const [left, due] of [['1 left · 2 reviewed', 1], [null, 0]] as const) {
      await page.getByRole('button', { name: /Show answer/ }).click()
      await grades.getByRole('button', { name: /Easy/ }).click()
      if (left) await expect(page.getByText(left)).toBeVisible()
      await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(due)
    }
    await expect(page.getByText(/^All done/)).toBeVisible()
    expect((await api.stats(deck.id)).reviewedToday).toBe(6)
  })
})
