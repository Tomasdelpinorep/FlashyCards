/**
 * Shared e2e fixtures and helpers.
 *
 * - `api`: a thin client for the app's own authenticated API (the e2e server's localhost dev
 *   bypass makes every request the e2e user). Used to arrange state quickly; there is no test-only
 *   endpoint or backdoor.
 * - `deck` (auto): every test starts from the same state as a first login: all decks deleted, one
 *   fresh "German" en->de deck, default user settings. Browser storage is fresh per test anyway.
 * - `shot(name)`: full-page screenshot to $E2E_SCREENSHOTS_DIR (default test-results/screens) as
 *   `<project>-<name>.png`; `shot(name, { dark: true })` re-renders with prefers-color-scheme: dark.
 * - page errors and console errors fail the test (allow known noise with `allowConsole`).
 * - speech recognition is stubbed out (undefined), so the answer box shows no mic button.
 */
import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_USER_SETTINGS,
  type CardDTO,
  type CardListResponse,
  type DeckDTO,
  type DeckSettings,
  type DeckStats,
  type GenerateResponse,
  type ImportResponse,
  type LearnQueueResponse,
  type MeResponse,
  type ReviewQueueResponse,
  type ReviewResponse,
  type SuggestResponse,
  type UserSettings,
} from '../src/shared/schemas'

export { expect }

export const SCREENSHOTS_DIR = path.resolve(process.env.E2E_SCREENSHOTS_DIR ?? 'test-results/screens')

const tzOffset = () => String(new Date().getTimezoneOffset())

export class Api {
  constructor(readonly req: APIRequestContext) {}

  private async json<T>(res: APIResponse): Promise<T> {
    if (!res.ok()) throw new Error(`${res.url()} -> ${res.status()} ${await res.text()}`)
    return (await res.json()) as T
  }

  me() {
    return this.req.get('/api/me').then((r) => this.json<MeResponse>(r))
  }

  /**
   * Back to a first-login state: one "German" en->de deck, default settings. The deck sends
   * imported words to Learn (importToTrain off, like decks made before that setting), since most
   * specs import words to study them in Learn; import-to-train.spec.ts turns it on.
   */
  async reset(): Promise<DeckDTO> {
    const me = await this.me()
    for (const d of me.decks) await this.deleteDeck(d.id)
    await this.updateSettings(DEFAULT_USER_SETTINGS)
    return this.createDeck('German', 'en', 'de', { importToTrain: false })
  }

  updateSettings(settings: Partial<UserSettings>) {
    return this.req.patch('/api/me', { data: { settings } }).then((r) => this.json<unknown>(r))
  }

  createDeck(name: string, sourceLang: string, targetLang: string, settings?: Partial<DeckSettings>): Promise<DeckDTO> {
    return this.req
      .post('/api/decks', { data: { name, sourceLang, targetLang, ...(settings ? { settings } : {}) } })
      .then((r) => this.json<{ deck: DeckDTO }>(r))
      .then((r) => r.deck)
  }

  async deleteDeck(id: string) {
    await this.json(await this.req.delete(`/api/decks/${id}`))
  }

  updateDeck(id: string, body: { name?: string; settings?: Partial<DeckSettings> }) {
    return this.req.patch(`/api/decks/${id}`, { data: body }).then((r) => this.json<{ deck: DeckDTO }>(r))
  }

  import(deckId: string, text: string, inputLang: 'target' | 'source' | 'auto' = 'target') {
    return this.req.post(`/api/decks/${deckId}/import`, { data: { text, inputLang } }).then((r) => this.json<ImportResponse>(r))
  }

  suggest(deckId: string, count: number) {
    return this.req.post(`/api/decks/${deckId}/suggest`, { data: { count } }).then((r) => this.json<SuggestResponse>(r))
  }

  /** Runs POST /generate until nothing is pending (what the client's loop does). */
  async generateAll(deckId: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const r = await this.req.post(`/api/decks/${deckId}/generate`).then((res) => this.json<GenerateResponse>(res))
      if (r.remaining === 0) return
    }
    throw new Error('generateAll: still pending after 60 calls')
  }

  /** Import `text` and wait until every card is generated; returns the ready cards, oldest first. */
  async readyCards(deckId: string, text: string, inputLang: 'target' | 'source' | 'auto' = 'target'): Promise<CardDTO[]> {
    await this.import(deckId, text, inputLang)
    await this.generateAll(deckId)
    const list = await this.cards(deckId, { status: 'ready', limit: '100' })
    return list.cards.reverse()
  }

  stats(deckId: string): Promise<DeckStats> {
    return this.req
      .get(`/api/decks/${deckId}/stats`, { params: { tzOffset: tzOffset() } })
      .then((r) => this.json<{ stats: DeckStats }>(r))
      .then((r) => r.stats)
  }

  cards(deckId: string, params: Record<string, string> = {}) {
    return this.req.get(`/api/decks/${deckId}/cards`, { params }).then((r) => this.json<CardListResponse>(r))
  }

  learn(deckId: string) {
    return this.req.get(`/api/decks/${deckId}/learn`, { params: { tzOffset: tzOffset() } }).then((r) => this.json<LearnQueueResponse>(r))
  }

  reviewQueue(deckId: string, ahead = false) {
    return this.req
      .get(`/api/decks/${deckId}/review`, { params: ahead ? { ahead: '1' } : {} })
      .then((r) => this.json<ReviewQueueResponse>(r))
  }

  review(cardId: string, rating: 1 | 2 | 3 | 4, direction: 'target-source' | 'source-target' = 'target-source') {
    return this.req
      .post('/api/reviews', { data: { id: crypto.randomUUID(), cardId, rating, direction, reviewedAt: Date.now(), durationMs: 1000 } })
      .then((r) => this.json<ReviewResponse>(r))
  }
}

/** A pronounceable, letters-only word unique to this run (the fake AI treats digits as junk). */
export function newWord(capitalize = true): string {
  const c = 'bdfgklmnprstvz'
  const v = 'aeiou'
  let s = ''
  for (let i = 0; i < 7; i++) {
    const set = i % 2 ? v : c
    s += set[Math.floor(Math.random() * set.length)]
  }
  return capitalize ? s[0]!.toUpperCase() + s.slice(1) : s
}

type ShotOptions = { dark?: boolean; fullPage?: boolean }

type Fixtures = {
  api: Api
  deck: DeckDTO
  shot: (name: string, opts?: ShotOptions) => Promise<void>
  allowConsole: RegExp[]
}

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(new Api(request))
  },
  deck: [
    async ({ api }, use) => {
      await use(await api.reset())
    },
    { auto: true },
  ],
  allowConsole: [[], { option: true }],
  shot: async ({ page }, use, testInfo) => {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true })
    await use(async (name, opts = {}) => {
      const file = path.join(SCREENSHOTS_DIR, `${testInfo.project.name}-${name}.png`)
      if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot({ path: file, fullPage: opts.fullPage ?? true, animations: 'disabled', caret: 'hide' })
      if (opts.dark) await page.emulateMedia({ colorScheme: 'light' })
    })
  },
  page: async ({ page, allowConsole }, use) => {
    // No speech recognition in e2e: the mic button stays hidden (typed answers only).
    await page.addInitScript(() => {
      for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true })
    })
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const text = m.text()
      if (allowConsole.some((re) => re.test(text))) return
      problems.push(`console.error: ${text}`)
    })
    await use(page)
    expect(problems, 'page errors / console errors').toEqual([])
  },
})

/** Fails on serious or critical axe violations (WCAG 2 A/AA rules plus best practices). */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const bad = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(bad, `axe violations on ${label}`).toEqual([])
}

/** The bounding box of `locator`'s element must be at least 44x44 CSS px (touch targets). */
export async function tapTargetSize(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }
      })
      .filter((b) => b.w > 0 && b.h > 0),
  )
}
