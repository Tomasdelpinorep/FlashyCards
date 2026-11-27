/**
 * Imports go to Train (docs/DECISIONS.md "Imports go to Train"): in a deck with importToTrain on
 * (every deck created from now on), imported words skip Learn and are due in Train at once.
 * Decks made before have no importToTrain and keep the old behaviour (imports go to Learn).
 * Runs on the real seeded dictionary, without AI.
 */
import { describe, expect, it } from 'vitest'
import { termKey } from '../../src/shared/normalize'
import type { CardDTO, DeckDTO, DeckStats, LearnQueueResponse, MeResponse, ReviewQueueResponse } from '../../src/shared/schemas'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
type Ctx = ReturnType<typeof setup>

const seeded = (): Ctx => setup({}, { generator: null, seed: true })

async function firstDeck(ctx: Ctx): Promise<DeckDTO> {
  return ((await (await ctx.as(ALICE, '/api/me')).json()) as MeResponse).decks[0]!
}
async function importWords(ctx: Ctx, deck: string, text: string) {
  const res = await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang: 'target' } })
  expect(res.status).toBe(200)
  expect((await ctx.as(ALICE, `/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(200)
}
const terms = (cards: CardDTO[]) => cards.map((c) => c.inputTerm).sort()
async function learn(ctx: Ctx, deck: string) {
  return (await (await ctx.as(ALICE, `/api/decks/${deck}/learn`)).json()) as LearnQueueResponse
}
async function train(ctx: Ctx, deck: string) {
  return (await (await ctx.as(ALICE, `/api/decks/${deck}/review`)).json()) as ReviewQueueResponse
}
async function stats(ctx: Ctx, deck: string) {
  return ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats`)).json()) as { stats: DeckStats }).stats
}
/** Make a deck look like one created before importToTrain existed (no key in its settings). */
function makeOld(ctx: Ctx, deck: string) {
  ctx.sqlite.prepare(`UPDATE decks SET settings_json = json_remove(settings_json, '$.importToTrain') WHERE id = ?`).run(deck)
}

describe('the importToTrain deck setting', () => {
  it('is on for a new user’s first deck and for new decks, off for decks made before it', async () => {
    const ctx = seeded()
    const first = await firstDeck(ctx)
    expect(first.settings.importToTrain).toBe(true)
    const res = await ctx.as(ALICE, '/api/decks', { method: 'POST', body: { name: 'Zwei', sourceLang: 'en', targetLang: 'de' } })
    expect(((await res.json()) as { deck: DeckDTO }).deck.settings.importToTrain).toBe(true)
    makeOld(ctx, first.id)
    expect((await firstDeck(ctx)).settings.importToTrain).toBe(false)
  })
})

describe('importing into a deck with importToTrain', () => {
  it('puts the words in Train, due now, and not in Learn', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    await importWords(ctx, deck, 'Hund\nAuto\nHaus')
    expect(terms((await train(ctx, deck)).cards)).toEqual(['Auto', 'Haus', 'Hund'])
    expect(await learn(ctx, deck)).toMatchObject({ cards: [], readyNewTotal: 0 })
    expect(await stats(ctx, deck)).toMatchObject({ ready: 3, new: 0, dueNow: 3 })
  })

  it('reviewing one in Train schedules it normally and does not use up the daily Learn limit', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    await importWords(ctx, deck, 'Hund')
    const card = (await train(ctx, deck)).cards[0]!
    const body = { id: crypto.randomUUID(), cardId: card.id, rating: 3, direction: 'target-source', reviewedAt: Date.now(), durationMs: 900 }
    expect((await ctx.as(ALICE, '/api/reviews', { method: 'POST', body })).status).toBe(200)
    const row = ctx.sqlite.prepare('SELECT state, reps FROM cards WHERE id = ?').get(card.id) as { state: number; reps: number }
    expect(row.state).toBeGreaterThan(0)
    expect(row.reps).toBe(1)
    expect((await learn(ctx, deck)).newToday).toBe(0)
    expect((await stats(ctx, deck)).newToday).toBe(0)
  })

  it('keeps suggested words ("Add new words") in Learn', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    const list = ctx.sqlite.prepare("INSERT INTO wordlist (lang, rank, lemma, lemma_key, pos) VALUES ('de', ?, ?, ?, 'other')")
    ;['Kind', 'Schule'].forEach((lemma, i) => list.run(i + 1, lemma, termKey('de', lemma)))
    expect((await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 2 } })).status).toBe(200)
    expect(terms((await learn(ctx, deck)).cards)).toEqual(['Kind', 'Schule'])
    expect((await train(ctx, deck)).cards).toEqual([])
  })

  it('sends a word whose meaning the user types to Train too', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    await importWords(ctx, deck, 'Zwetschge')
    const id = (ctx.sqlite.prepare('SELECT id FROM cards WHERE deck_id = ?').get(deck) as { id: string }).id
    const res = await ctx.as(ALICE, `/api/cards/${id}/meaning`, { method: 'POST', body: { word: 'Zwetschge', translation: 'plum', gender: 'feminine' } })
    expect(res.status).toBe(200)
    expect(terms((await train(ctx, deck)).cards)).toEqual(['Zwetschge'])
    expect((await learn(ctx, deck)).cards).toEqual([])
  })
})

describe('existing decks', () => {
  it('keep sending imported words to Learn', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    makeOld(ctx, deck)
    await importWords(ctx, deck, 'Hund\nAuto')
    expect(terms((await learn(ctx, deck)).cards)).toEqual(['Auto', 'Hund'])
    expect((await train(ctx, deck)).cards).toEqual([])
  })

  it('switching the setting on moves only words imported afterwards', async () => {
    const ctx = seeded()
    const deck = (await firstDeck(ctx)).id
    makeOld(ctx, deck)
    await importWords(ctx, deck, 'Hund')
    const res = await ctx.as(ALICE, `/api/decks/${deck}`, { method: 'PATCH', body: { settings: { importToTrain: true } } })
    expect(res.status).toBe(200)
    await importWords(ctx, deck, 'Auto')
    expect(terms((await learn(ctx, deck)).cards)).toEqual(['Hund'])
    expect(terms((await train(ctx, deck)).cards)).toEqual(['Auto'])
  })
})
