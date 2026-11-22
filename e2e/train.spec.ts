import type { Page } from '@playwright/test'
import { expect, expectAccessible, test } from './fixtures'

/** The fake AI's en<->de pairs used here. */
const DE: Record<string, string> = { dog: 'der Hund', cat: 'die Katze', house: 'das Haus' }
const EN: Record<string, string> = { 'der Hund': 'dog', 'die Katze': 'cat', 'das Haus': 'house' }

/** Ratings posted to /api/reviews, in order. */
function collectRatings(page: Page): number[] {
  const ratings: number[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/reviews')) ratings.push((r.postDataJSON() as { rating: number }).rating)
  })
  return ratings
}

/** The English word on the front of an EN->DE card. */
async function frontEnglish(page: Page): Promise<string> {
  const text = (await page.getByTestId('study-card').innerText()).trim()
  const word = Object.keys(DE).find((w) => text.startsWith(w))
  if (!word) throw new Error(`unexpected front: ${text}`)
  return word
}

async function frontGerman(page: Page): Promise<string> {
  const text = (await page.getByTestId('study-card').innerText()).trim()
  const word = Object.keys(EN).find((w) => text.startsWith(w))
  if (!word) throw new Error(`unexpected front: ${text}`)
  return word
}

test.describe('train', () => {
  test('empty state when nothing has been studied', async ({ page, api, deck }) => {
    await api.readyCards(deck.id, 'Hund')
    await page.goto('/train')
    await expect(page.getByText('All done', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing to review yet. Words you study will show up here.')).toBeVisible()
  })

  test('typed answers: correct flips without Enter, missing article, override', async ({ page, api, deck, shot }) => {
    const cards = await api.readyCards(deck.id, 'Hund\nKatze\nHaus')
    for (const c of cards) await api.review(c.id, 1) // Learning, due within the learn-ahead window
    await api.updateSettings({ studyDirection: 'source-target' })
    const ratings = collectRatings(page)

    await page.goto('/train')
    const answer = page.getByLabel('Type the German word')
    await expect(answer).toBeFocused()
    await shot('train-answering')
    await expectAccessible(page, 'train answering')

    // 1. The right answer, typed: flips at once (no Enter), Good, moves on by itself.
    let en = await frontEnglish(page)
    await answer.pressSequentially(DE[en]!.toUpperCase().replace(' ', '  '))
    await expect(page.getByTestId('verdict')).toHaveText('✓ Correct')
    await expect(page.getByText(/ · 1 reviewed$/)).toBeVisible()
    await expect.poll(() => ratings).toEqual([3])

    // 2. Without the article + Enter: "Missing the article", Again (Enter moves on).
    en = await frontEnglish(page)
    await answer.fill(DE[en]!.split(' ')[1]!)
    await answer.press('Enter')
    await expect(page.getByTestId('verdict')).toHaveText(`Missing the article: ${DE[en]}`)
    await expect(page.getByRole('button', { name: /Next/ })).toBeFocused()
    await shot('train-missing-article')
    await expectAccessible(page, 'train revealed')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/ · 2 reviewed$/)).toBeVisible()
    await expect.poll(() => ratings).toEqual([3, 1])

    // 3. Wrong, then the "I was right" override: Good, sent once.
    await answer.fill('der Quatsch')
    await answer.press('Enter')
    await expect(page.getByTestId('verdict')).toContainText('Not quite. The answer is')
    await expect(page.getByText('Your answer')).toBeVisible()
    await page.getByRole('button', { name: /I was right/ }).click()
    await expect.poll(() => ratings).toEqual([3, 1, 3])
    await expect(page.getByText(/ · 3 reviewed$/)).toBeVisible()
  })

  test('a typo is "Almost" and graded Hard', async ({ page, api, deck }) => {
    const [katze] = await api.readyCards(deck.id, 'Katze')
    await api.review(katze!.id, 1)
    await api.updateSettings({ studyDirection: 'source-target' })
    const ratings = collectRatings(page)
    await page.goto('/train')
    const answer = page.getByLabel('Type the German word')
    await answer.fill('die Katz')
    await answer.press('Enter')
    await expect(page.getByTestId('verdict')).toHaveText('Almost — check the spelling')
    await page.getByRole('button', { name: /Next/ }).click()
    await expect.poll(() => ratings).toEqual([2])
  })

  test('direction toggle, Show answer and the keyboard grades', async ({ page, api, deck, shot }) => {
    const ratings = collectRatings(page)
    const cards = await api.readyCards(deck.id, 'Hund\nKatze\nHaus')
    for (const c of cards) await api.review(c.id, 1)
    await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(3)

    await page.goto('/')
    await page.getByRole('link', { name: /Train · 3 due/ }).click()
    const card = page.getByTestId('study-card')
    const direction = page.getByRole('radiogroup', { name: 'Direction' })
    await expect(direction.getByRole('radio', { name: 'DE→EN' })).toHaveAttribute('aria-checked', 'true')
    await expect(card).toContainText(/der Hund|die Katze|das Haus/)

    // DE -> EN: the English meaning, with "to"/articles optional.
    const de = await frontGerman(page)
    await page.getByLabel('Type the English meaning').fill(`the ${EN[de]}`)
    await expect(page.getByTestId('verdict')).toHaveText('✓ Correct')
    await expect(page.getByText(/ · 1 reviewed$/)).toBeVisible() // moved on by itself

    // EN -> DE: the front shows the translation; the choice is saved to the user's settings.
    await direction.getByRole('radio', { name: 'EN→DE' }).click()
    await expect(direction.getByRole('radio', { name: 'EN→DE' })).toHaveAttribute('aria-checked', 'true')
    await expect(card).toContainText(/^(dog|cat|house)/)
    await expect.poll(async () => (await api.me()).user.settings.studyDirection).toBe('source-target')
    await shot('train-front-source-target')

    // Show answer (give up), then 4 = Easy from the keyboard.
    await page.getByRole('button', { name: 'Show answer' }).click()
    const grades = page.getByRole('group', { name: 'How well did you know it?' })
    await expect(grades.getByRole('button', { name: /Easy/ })).toBeEnabled()
    await shot('train-back')
    await page.keyboard.press('4')
    await expect(page.getByText(/ · 2 reviewed$/)).toBeVisible()

    await page.getByRole('button', { name: 'Show answer' }).click()
    await grades.getByRole('button', { name: /Easy/ }).click()
    await expect.poll(() => ratings).toEqual([3, 4, 4])
    await expect.poll(async () => (await api.stats(deck.id)).reviewedToday).toBe(6)
  })
})
