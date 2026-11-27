import { expect, expectAccessible, test } from './fixtures'

test.describe('imports go to Train', () => {
  test('with the deck setting on, imported words skip Learn and can be trained at once', async ({ page, api, deck, shot }) => {
    // The e2e deck starts like an existing deck (setting off); turn it on in Settings.
    await page.goto('/settings')
    const toggle = page.getByRole('switch', { name: /Imported words go straight to Train/ })
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await api.me()).decks[0]!.settings.importToTrain).toBe(true)
    await expectAccessible(page, 'settings with the import-to-train switch')

    await page.goto('/add')
    await page.getByRole('tab', { name: 'Import' }).click()
    await expect(page.getByText('Imported words go straight to Train.')).toBeVisible()
    await page.getByLabel('One word per line').fill('Hund\ngehen')
    await page.getByRole('button', { name: 'Import 2 words' }).click()
    const trainNow = page.getByRole('link', { name: 'Train them now' })
    await expect(trainNow).toBeVisible()
    await expect(page.getByRole('link', { name: 'Learn them now' })).toHaveCount(0)
    await shot('import-to-train-summary')

    await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(2)
    expect((await api.stats(deck.id)).new).toBe(0)
    await trainNow.click()
    await expect(page).toHaveURL(/\/train$/)
    await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible()
    await shot('import-to-train-train')
  })
})
