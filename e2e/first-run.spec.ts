import { expect, newWord, test } from './fixtures'

test.describe('first run', () => {
  test('home shows the default German deck, the empty-deck guidance and empty states everywhere', async ({ page, shot }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'FlashyCards' })).toBeVisible()
    await expect(page.getByTestId('deck-name')).toHaveText('German')

    // Empty deck: guidance instead of a grid of zeros.
    const empty = page.getByTestId('empty-deck')
    await expect(empty.getByRole('heading', { name: 'Add words to start' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Deck stats' })).toHaveCount(0)
    await expect(empty.getByRole('link', { name: 'Add words' })).toBeVisible()
    await shot('home-empty-deck')
    await shot('home-empty-deck-dark', { dark: true })
    await empty.getByRole('link', { name: 'Import a list' }).click()
    await expect(page.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true')

    // Train: nothing studied yet.
    await page.goto('/train')
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

  test('words that are not ready yet: the stats show with a note', async ({ page, api, deck }) => {
    // Imported but never generated: the page's generation loop gets "no progress" answers.
    await page.route('**/api/decks/*/generate', (route) =>
      route.fulfill({ json: { processed: 0, fromCache: 0, generated: 0, failed: 0, remaining: 2, rateLimited: false, duplicates: [] } }),
    )
    await api.import(deck.id, `${newWord()}\n${newWord()}`)
    await page.goto('/')
    await expect(page.getByTestId('none-ready')).toContainText('None of your words are ready to study yet.')
    await expect(page.getByRole('region', { name: 'Deck stats' })).toBeVisible()
  })
})
