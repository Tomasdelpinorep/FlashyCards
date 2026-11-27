/**
 * App language (docs/DECISIONS.md "App language"): a new user starts in their browser's language,
 * and switching it (PATCH /me { settings: { uiLang } }) converts the decks to the new source
 * language, keeping every card and its progress. Runs on the real seeded dictionary, without AI.
 */
import { describe, expect, it } from 'vitest'
import { uiLanguageFromPreferences } from '../../src/shared/languages'
import { glossKey } from '../../src/shared/normalize'
import type { CardDTO, CardListResponse, MeResponse } from '../../src/shared/schemas'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
type Ctx = ReturnType<typeof setup>

const seeded = (): Ctx => setup({}, { generator: null, seed: true })

async function me(ctx: Ctx, headers?: Record<string, string>): Promise<MeResponse> {
  const res = await ctx.as(ALICE, '/api/me', { headers })
  expect(res.status).toBe(200)
  return (await res.json()) as MeResponse
}
async function switchTo(ctx: Ctx, uiLang: 'en' | 'es'): Promise<MeResponse> {
  const res = await ctx.as(ALICE, '/api/me', { method: 'PATCH', body: { settings: { uiLang } } })
  expect(res.status).toBe(200)
  return (await res.json()) as MeResponse
}
async function post(ctx: Ctx, path: string, body?: unknown) {
  const res = await ctx.as(ALICE, path, { method: 'POST', body })
  expect(res.ok).toBe(true)
  return res.json()
}
async function cards(ctx: Ctx, deck: string): Promise<CardDTO[]> {
  return ((await (await ctx.as(ALICE, `/api/decks/${deck}/cards`)).json()) as CardListResponse).cards
}
const byTerm = (list: CardDTO[], term: string) => list.find((c) => c.inputTerm === term)!

describe('uiLanguageFromPreferences', () => {
  it.each([
    ['es-ES,es;q=0.9,en;q=0.8', 'es'],
    ['es-AR', 'es'],
    ['en-US,en;q=0.9', 'en'],
    ['de-DE,es;q=0.5', 'es'], // German is not an app language: the next listed one wins
    ['en;q=0.2,es;q=0.9', 'es'], // by quality, not position
    ['fr-FR', 'en'],
    ['es;q=0', 'en'],
    ['', 'en'],
    [null, 'en'],
  ])('%s -> %s', (header, lang) => {
    expect(uiLanguageFromPreferences(header)).toBe(lang)
  })
  it('takes navigator.languages too', () => {
    expect(uiLanguageFromPreferences(['es-MX', 'en-US'])).toBe('es')
  })
})

describe('a new user', () => {
  it('starts in Spanish with a Spanish -> German deck when the browser prefers Spanish', async () => {
    const ctx = seeded()
    const m = await me(ctx, { 'Accept-Language': 'es-ES,es;q=0.9' })
    expect(m.user.settings.uiLang).toBe('es')
    expect(m.decks).toHaveLength(1)
    expect(m.decks[0]).toMatchObject({ name: 'Alemán', sourceLang: 'es', targetLang: 'de' })
  })

  it('starts in English otherwise, and later requests never change it', async () => {
    const ctx = seeded()
    expect((await me(ctx, { 'Accept-Language': 'fr' })).user.settings.uiLang).toBe('en')
    const again = await me(ctx, { 'Accept-Language': 'es' })
    expect(again.user.settings.uiLang).toBe('en')
    expect(again.decks[0]).toMatchObject({ name: 'German', sourceLang: 'en' })
  })
})

describe('switching the app language', () => {
  async function englishDeckWithWords(ctx: Ctx) {
    const deck = (await me(ctx)).decks[0]!.id
    await post(ctx, `/api/decks/${deck}/import`, { text: 'der Hund\nZwetschge\nTeekessel', inputLang: 'target' })
    await post(ctx, `/api/decks/${deck}/generate`)
    const list = await cards(ctx, deck)
    // Progress on Hund, and a meaning typed by hand for Zwetschge (not in the dictionary).
    ctx.sqlite.prepare('UPDATE cards SET reps = 4, stability = 7.5, state = 2, last_review = 1 WHERE id = ?').run(byTerm(list, 'der Hund').id)
    const res = await ctx.as(ALICE, `/api/cards/${byTerm(list, 'Zwetschge').id}/meaning`, { method: 'POST', body: { word: 'Zwetschge', translation: 'plum', gender: 'feminine' } })
    expect(res.status).toBe(200)
    return deck
  }

  it('converts the deck to Spanish meanings and keeps the cards and their progress', async () => {
    const ctx = seeded()
    const deck = await englishDeckWithWords(ctx)
    const before = await cards(ctx, deck)
    expect(byTerm(before, 'der Hund').translation).toBe('dog')

    const m = await switchTo(ctx, 'es')
    expect(m.user.settings.uiLang).toBe('es')
    expect(m.decks[0]).toMatchObject({ id: deck, name: 'Alemán', sourceLang: 'es', targetLang: 'de' })

    const after = await cards(ctx, deck)
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort())
    const hund = byTerm(after, 'der Hund')
    expect(hund.translation).toBe('perro')
    expect(hund.content?.exampleSource).toMatch(/\[\[.+\]\]/)
    expect(hund.srs).toEqual(byTerm(before, 'der Hund').srs)
    // The user's own meaning is theirs: kept as typed.
    expect(byTerm(after, 'Zwetschge').translation).toBe('plum')
    // Duplicate detection uses the Spanish glosses now.
    const glosses = ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ?').all(hund.id).map((r) => (r as { gloss_key: string }).gloss_key)
    expect(glosses).toContain(glossKey('es', 'perro'))
    expect(glosses).not.toContain(glossKey('en', 'dog'))
  })

  it('re-queues words still waiting for a meaning, so the new dictionary can answer them', async () => {
    const ctx = seeded()
    const deck = await englishDeckWithWords(ctx)
    expect(byTerm(await cards(ctx, deck), 'Teekessel')).toMatchObject({ status: 'failed', genError: 'needs_meaning' })
    await switchTo(ctx, 'es')
    expect(byTerm(await cards(ctx, deck), 'Teekessel').status).toBe('pending')
  })

  it('finds a Spanish word typed after the switch as the same card (no duplicate)', async () => {
    const ctx = seeded()
    const deck = await englishDeckWithWords(ctx)
    await switchTo(ctx, 'es')
    const count = (await cards(ctx, deck)).length
    await post(ctx, `/api/decks/${deck}/import`, { text: 'perro', inputLang: 'source' })
    await post(ctx, `/api/decks/${deck}/generate`)
    const live = (await cards(ctx, deck)).filter((c) => c.status !== 'duplicate')
    expect(live).toHaveLength(count)
  })

  it('switches back to English the same way', async () => {
    const ctx = seeded()
    const deck = await englishDeckWithWords(ctx)
    await switchTo(ctx, 'es')
    const m = await switchTo(ctx, 'en')
    expect(m.decks[0]).toMatchObject({ name: 'German', sourceLang: 'en' })
    const hund = byTerm(await cards(ctx, deck), 'der Hund')
    expect(hund.translation).toBe('dog')
    expect(hund.srs.reps).toBe(4)
  })

  it('keeps a renamed deck’s name, and leaves a deck that teaches the new language alone', async () => {
    const ctx = seeded()
    const deck = (await me(ctx)).decks[0]!.id
    await ctx.as(ALICE, `/api/decks/${deck}`, { method: 'PATCH', body: { name: 'Mein Deutsch' } })
    await post(ctx, '/api/decks', { name: 'Spanish', sourceLang: 'en', targetLang: 'es' })
    const m = await switchTo(ctx, 'es')
    expect(m.decks.map((d) => [d.name, d.sourceLang, d.targetLang])).toEqual([
      ['Mein Deutsch', 'es', 'de'],
      ['Spanish', 'en', 'es'],
    ])
  })

  it('changes nothing when the language stays the same', async () => {
    const ctx = seeded()
    await me(ctx)
    const m = await switchTo(ctx, 'en')
    expect(m.decks[0]).toMatchObject({ name: 'German', sourceLang: 'en' })
  })
})
