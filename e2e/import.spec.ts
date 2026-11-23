import type { Page } from '@playwright/test'
import { expect, newWord, test } from './fixtures'

/**
 * Holds POST /generate calls until `release()` so a test can look at the "Preparing…" state.
 * The fake generator answers in milliseconds, which is too quick to see otherwise.
 */
async function holdGenerate(page: Page) {
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  let calls = 0
  await page.route('**/api/decks/*/generate', async (route) => {
    calls++
    await released
    await route.continue()
  })
  return { release, calls: () => calls }
}

const LONG = `Donaudampfschifffahrtsgesellschaftskapitaensmuetzenabzeichenherstellungsgesellschaftsmitarbeiterinnenverband`

test.describe('import', () => {
  test('pasted acceptance list: live preview, import, summary, words list and card detail', async ({ page, shot, api, deck }) => {
    expect(LONG.length).toBeGreaterThan(100)
    await page.goto('/add')
    await page.getByRole('tab', { name: 'Import' }).click()
    await expect(page.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true')
    await shot('add-words-import-tab-empty')

    // PLAN M3 / DUPLICATES 10.9 acceptance list, plus one unreadable (too long) row.
    await page.getByLabel('One word per line').fill(`der Hund\nHund\nKatze;cat\n# comment\n\ngehen\n${LONG}`)
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview.getByText('3 words to import')).toBeVisible()
    await expect(preview.getByText('der Hund', { exact: true })).toBeVisible()
    await expect(preview.getByText('Katze')).toBeVisible()
    await preview.getByText('1 listed twice (skipped)').click()
    await expect(preview.getByText('Line 2: Hund (same as line 1)')).toBeVisible()
    await preview.getByText("1 can't be read").click()
    await expect(preview.getByText(/Line 7: .* \(longer than 100 characters\)/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 3 words' })).toBeEnabled()
    await shot('add-words-import-preview')

    await page.getByRole('button', { name: 'Import 3 words' }).click()
    const summary = page.getByRole('status').filter({ hasText: 'Added 3 words' })
    // DUPLICATES.md 10.8: "Added 18 words · 3 already in your deck · 1 couldn't be read".
    await expect(summary.getByText("Added 3 words · 1 already in your deck · 1 couldn't be read", { exact: true })).toBeVisible()
    await summary.getByText('1 already in your deck', { exact: true }).click()
    await expect(summary.getByRole('link', { name: 'Hund (line 2): listed twice in this import' })).toBeVisible()
    await summary.getByText("1 couldn't be read", { exact: true }).click()
    await expect(summary.getByText(/Line 7: .* \(longer than 100 characters\)/)).toBeVisible()

    // The generation loop finishes: nothing left to prepare.
    await expect(page.getByText(/Looking up \d+ words?/)).toHaveCount(0)
    await expect.poll(async () => (await api.stats(deck.id)).ready).toBe(3)
    await shot('add-words-import-summary')

    await page.getByRole('link', { name: 'See your words' }).click()
    await expect(page).toHaveURL(/\/words$/)
    const rows = page.getByRole('listitem')
    await expect(rows.filter({ hasText: 'der Hund' })).toContainText('dog')
    await expect(rows.filter({ hasText: 'die Katze' })).toContainText('cat')
    await expect(rows.filter({ hasText: 'gehen' })).toContainText('to go')
    await expect(page.getByText('Preparing…')).toHaveCount(0)
    await shot('words-list')

    await rows.filter({ hasText: 'der Hund' }).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Word' })).toBeVisible()
    const card = page.getByRole('main')
    await expect(card.locator('.text-blue-600').getByText('der', { exact: true })).toBeVisible()
    await expect(card.getByText('Plural: die Hunde')).toBeVisible()
    await expect(card.getByRole('paragraph').filter({ hasText: /^dog$/ })).toBeVisible()
    // Hund comes from the curated dictionary (migrations/0003_seed_de.sql), not the fake AI.
    await expect(card.locator('mark', { hasText: 'Hund' })).toBeVisible()
    await expect(card.getByText('Unser Hund heißt Bruno.')).toBeVisible()
    await expect(card.getByText('Our dog is called Bruno.')).toBeVisible()
    await shot('card-detail-noun')
    await shot('card-detail-noun-dark', { dark: true })

    // A verb shows its forms; a feminine noun a red article.
    await page.goto('/words')
    await rows.filter({ hasText: 'gehen' }).getByRole('link').click()
    await expect(card.getByText('geht · ging · ist gegangen')).toBeVisible()
    await page.goto('/words')
    await rows.filter({ hasText: 'die Katze' }).getByRole('link').click()
    await expect(card.locator('.text-red-600').getByText('die', { exact: true })).toBeVisible()
    await expect(card.getByText('Your hint: cat')).toBeVisible()
  })

  test('file upload (.tsv with a header row) shows progress until generation completes', async ({ page, shot, api, deck }, testInfo) => {
    const words = [newWord(), newWord(), newWord()]
    const file = testInfo.outputPath('vocab.tsv')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, `Wort\tBedeutung\n${words[0]}\tthing\n${words[1]}\tplace\n${words[2]}\tidea\n`)

    await page.goto('/add')
    await page.getByRole('tab', { name: 'Import' }).click()
    await page.locator('input[type=file]').setInputFiles(file)
    await expect(page.getByText('vocab.tsv')).toBeVisible()
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview.getByText('3 words to import')).toBeVisible()
    await expect(preview.getByText('Skipping the header row (line 1).')).toBeVisible()
    await expect(preview.getByText(`${words[0]} · thing`)).toBeVisible()
    await shot('add-words-import-file-preview')

    const gate = await holdGenerate(page)
    await page.getByRole('button', { name: 'Import 3 words' }).click()
    await expect(page.getByText('Added 3 words', { exact: true })).toBeVisible()
    // The banner shows as soon as preparation starts, before the first batch comes back.
    await expect(page.getByRole('status').filter({ hasText: 'Looking up 3 words… 0/3' })).toBeVisible()
    await shot('add-words-import-progress')
    gate.release()
    await expect(page.getByText(/Looking up \d+ words?/)).toHaveCount(0)
    await expect.poll(async () => (await api.stats(deck.id)).ready).toBe(3)
    await expect(page.getByRole('link', { name: 'Learn them now' })).toBeVisible()
    expect(gate.calls()).toBeGreaterThan(0)
  })

  test('English input resolved by the AI to a word already in the deck', async ({ page, shot, api, deck }, testInfo) => {
    // "dog" is in the curated dictionary, so it is a duplicate at import time. "pooch" is not: the
    // (fake) AI resolves it to Hund. The AI cache is global and survives between tests of one run,
    // so that post-AI path is observable only the first time a run imports "pooch".
    test.skip(testInfo.project.name !== 'mobile', 'post-AI path is observable once per run (shared AI cache)')
    await api.readyCards(deck.id, 'Hund')

    await page.goto('/add')
    await page.getByRole('tab', { name: 'Import' }).click()
    await page.getByRole('radio', { name: 'English' }).check({ force: true })
    await page.getByLabel('One word per line').fill('dog\npooch')
    await page.getByRole('button', { name: 'Import 2 words' }).click()
    const summary = page.getByRole('status').filter({ hasText: 'Added 1 word' })
    await expect(summary.getByText('Added 1 word · 1 already in your deck', { exact: true })).toBeVisible()
    await summary.getByText('1 already in your deck', { exact: true }).click()
    await expect(summary.getByRole('link', { name: 'dog → der Hund: already in your deck', exact: true })).toBeVisible()

    // Found while looking up (reason 'resolved'), DUPLICATES.md 10.8 copy.
    const found = page.getByText('1 more already in your deck (found while looking up)')
    await expect(found).toBeVisible()
    await found.click()
    await expect(page.getByRole('link', { name: 'pooch → der Hund: already in your deck, added as a translation' })).toBeVisible()
    await shot('add-words-import-post-ai-duplicates')

    // Home: "1 word was already in your deck · View" -> the duplicates filter.
    await page.goto('/')
    await expect(page.getByText('1 word was already in your deck')).toBeVisible()
    await page.getByRole('link', { name: 'View' }).click()
    await expect(page).toHaveURL(/status=duplicate/)
    await expect(page.getByRole('listitem').filter({ hasText: 'pooch' })).toContainText('Already in your deck as der Hund')
    await shot('words-duplicates-filter')

    const hund = (await api.cards(deck.id, { status: 'ready' })).cards.find((c) => c.display === 'der Hund')!
    expect(hund.extraTranslations).toEqual(['pooch'])
    await page.goto(`/words/${hund.id}`)
    await expect(page.getByText('dog · also: pooch')).toBeVisible()
  })
})
