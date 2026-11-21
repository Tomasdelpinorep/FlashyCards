import { expect, test } from './fixtures'

test.describe('first run', () => {
  test('home shows the default German deck and empty states everywhere', async ({ page, shot }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Flashcards' })).toBeVisible()
    await expect(page.getByTestId('deck-name')).toHaveText('German')

    const stats = page.getByRole('region', { name: 'Deck stats' })
    await expect(stats.getByText('Words')).toBeVisible()
    await expect(page.getByRole('link', { name: /Train · 0 due/ })).toBeVisible()
    await expect(page.getByText(/Learn new · 0 ready/)).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('link', { name: 'Add words' })).toBeVisible()
    await shot('home-empty-deck')
    await shot('home-empty-deck-dark', { dark: true })

    // Train: nothing studied yet.
    await page.getByRole('link', { name: /Train · 0 due/ }).click()
    await expect(page).toHaveURL(/\/train$/)
    await expect(page.getByText('All done', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing to review yet. Words you study will show up here.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Practice anyway' })).toHaveCount(0)
    await shot('train-empty-nothing-studied')

    // Learn: no new words.
    await page.goto('/learn')
    await expect(page.getByText('No new words ready')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add words' })).toBeVisible()
    await shot('learn-empty-no-words')

    // Words: empty list.
    await page.getByRole('link', { name: 'Words', exact: true }).click()
    await expect(page.getByText('No words yet. Add some!')).toBeVisible()
    await shot('words-empty')
  })
})
