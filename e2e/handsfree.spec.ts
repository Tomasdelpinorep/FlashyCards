import type { Page } from '@playwright/test'
import { expect, expectAccessible, test } from './fixtures'

/** The fake AI's en->de pairs used here. */
const DE: Record<string, string> = { dog: 'der Hund', cat: 'die Katze', house: 'das Haus' }

async function frontEnglish(page: Page): Promise<string> {
  const text = (await page.getByTestId('study-card').innerText()).trim()
  const word = Object.keys(DE).find((w) => text.startsWith(w))
  if (!word) throw new Error(`unexpected front: ${text}`)
  return word
}

function collectRatings(page: Page): number[] {
  const ratings: number[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/reviews')) ratings.push((r.postDataJSON() as { rating: number }).rating)
  })
  return ratings
}

type FakeWindow = {
  __answerT: number
  __answerClock: () => number
  __recs: FakeRec[]
  __active: () => number
  __say: (text: string) => void
  __silence: () => void
}
type FakeRec = {
  started: boolean
  stopped: boolean
  onresult: ((e: unknown) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onspeechstart: (() => void) | null
}

/**
 * A fake webkitSpeechRecognition (the fixture removes the real one first) that the test drives:
 * __say(text) hears one final result, __silence() ends with 'no-speech'. Also freezes the
 * answer clock (see train.spec.ts).
 */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as FakeWindow
    w.__answerT = 0
    w.__answerClock = () => w.__answerT
    w.__recs = []
    class Rec {
      started = false
      stopped = false
      lang = ''
      interimResults = false
      continuous = false
      maxAlternatives = 1
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: { error: string }) => void) | null = null
      onend: (() => void) | null = null
      onspeechstart: (() => void) | null = null
      constructor() {
        w.__recs.push(this)
      }
      start() {
        this.started = true
      }
      stop() {
        if (this.stopped) return
        this.stopped = true
        setTimeout(() => this.onend?.(), 0)
      }
      abort() {
        this.stop()
      }
    }
    const live = () => w.__recs.filter((r) => r.started && !r.stopped)
    w.__active = () => live().length
    w.__say = (text) => {
      const r = live().at(-1)!
      r.onspeechstart?.()
      const result = Object.assign([{ transcript: text }], { isFinal: true })
      r.onresult?.({ results: [result] })
      r.stopped = true
      r.onend?.()
    }
    w.__silence = () => {
      const r = live().at(-1)!
      r.onerror?.({ error: 'no-speech' })
      r.stopped = true
      r.onend?.()
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Rec, configurable: true })
  })
}

const active = (page: Page) => page.evaluate(() => (window as unknown as FakeWindow).__active())

async function setup(page: Page, api: import('./fixtures').Api, deckId: string) {
  const cards = await api.readyCards(deckId, 'Hund\nKatze\nHaus')
  for (const c of cards) await api.review(c.id, 1) // Learning, due within the learn-ahead window
  await api.updateSettings({ studyDirection: 'source-target' })
}

test.describe('hands-free', () => {
  test('the mic switch stays on from card to card and across a reload, and pauses after silence', async ({ page, api, deck }) => {
    await setup(page, api, deck.id)
    await fakeSpeech(page)
    await page.goto('/train')
    const mic = page.getByRole('button', { name: 'Answer by voice' })
    await expect(mic).toHaveAttribute('aria-pressed', 'false')
    expect(await active(page)).toBe(0)

    // On: listens right away. Speech start ends the think time (3 s -> Good · 3.0 s).
    await mic.click()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => active(page)).toBe(1)
    await expect(page.getByText('Listening… speak now').first()).toBeVisible()
    await expectAccessible(page, 'train mic on')
    let en = await frontEnglish(page)
    await page.evaluate(() => ((window as unknown as FakeWindow).__answerT += 3000))
    await page.evaluate((t) => (window as unknown as FakeWindow).__say(t), DE[en]!)
    await expect(page.getByTestId('verdict')).toHaveText('✓ Correct')
    await expect(page.getByTestId('auto-grade')).toHaveText('Good · 3.0 s')
    expect(await active(page)).toBe(0) // not while revealed
    await page.keyboard.press('Enter')

    // The next card listens by itself; typing still works while the mic is on.
    await expect(page.getByText(/ · 1 reviewed$/)).toBeVisible()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => active(page)).toBe(1)
    en = await frontEnglish(page)
    await page.getByLabel('Type the German word').fill(DE[en]!)
    await expect(page.getByTestId('verdict')).toHaveText('✓ Correct')
    await expect.poll(() => active(page)).toBe(0)
    await page.keyboard.press('Enter')
    await expect(page.getByText(/ · 2 reviewed$/)).toBeVisible()

    // Remembered across a reload.
    await page.reload()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => active(page)).toBe(1)

    // Silence: listens again, and after three empty results in a row the switch turns off.
    for (let i = 0; i < 3; i++) {
      await expect.poll(() => active(page)).toBe(1)
      await page.evaluate(() => (window as unknown as FakeWindow).__silence())
    }
    await expect(mic).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Mic paused — tap to resume').first()).toBeVisible()
    expect(await active(page)).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('flashy.micOn.v1'))).toBe('0')

    // Tap to resume.
    await mic.click()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => active(page)).toBe(1)
  })

  test('Auto mode moves on after a correct answer, not after a wrong one, and any tap cancels it', async ({ page, api, deck }) => {
    await setup(page, api, deck.id)
    const ratings = collectRatings(page)
    await page.goto('/train')
    const auto = page.getByRole('switch', { name: 'Auto mode: move on by itself' })
    await expect(auto).toHaveAttribute('aria-checked', 'false')
    await auto.click()
    await expect(auto).toHaveAttribute('aria-checked', 'true')
    await expectAccessible(page, 'train auto on')
    const answer = page.getByLabel('Type the German word')
    const verdict = page.getByTestId('verdict')

    // Correct: flips, shows the grade with the countdown bar, then moves on by itself.
    let en = await frontEnglish(page)
    await answer.fill(DE[en]!)
    await expect(verdict).toHaveText('✓ Correct')
    await expect(page.getByTestId('auto-progress')).toBeAttached()
    await expect(page.getByText(/ · 1 reviewed$/)).toBeVisible({ timeout: 3000 })
    await expect.poll(() => ratings.length).toBe(1)

    // Wrong: waits for Enter.
    await answer.fill('der Quatsch')
    await answer.press('Enter')
    await expect(verdict).toContainText('Not quite')
    await expect(page.getByTestId('auto-progress')).toHaveCount(0)
    await page.waitForTimeout(2000)
    await expect(verdict).toContainText('Not quite')
    await expect(page.getByText(/ · 1 reviewed$/)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/ · 2 reviewed$/)).toBeVisible()

    // Correct, then "Change": no automatic move.
    en = await frontEnglish(page)
    await answer.fill(DE[en]!)
    await expect(verdict).toHaveText('✓ Correct')
    await page.getByRole('button', { name: 'Change grade' }).click()
    await page.waitForTimeout(2000)
    await expect(verdict).toHaveText('✓ Correct')
    await expect(page.getByText(/ · 2 reviewed$/)).toBeVisible()
    await page.keyboard.press('4')
    await expect(page.getByText(/ · 3 reviewed$/)).toBeVisible()
    await expect.poll(() => ratings.length).toBe(3)
    expect(ratings[2]).toBe(4)

    // Remembered across a reload.
    await page.reload()
    await expect(auto).toHaveAttribute('aria-checked', 'true')
  })

  test('the Learn quick check has no Auto switch', async ({ page, api, deck }) => {
    await api.readyCards(deck.id, 'Hund')
    await page.goto('/learn')
    await expect(page.getByText('New word')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByText('Quick check')).toBeVisible()
    await expect(page.getByLabel(/Type the/)).toBeVisible()
    await expect(page.getByRole('switch', { name: /Auto mode/ })).toHaveCount(0)
  })
})
