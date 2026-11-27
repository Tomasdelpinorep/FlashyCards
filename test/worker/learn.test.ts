import { describe, expect, it } from 'vitest'
import type { DeckStats, LearnQueueResponse, MeResponse, ReviewInput, ReviewQueueResponse, ReviewResponse } from '../../src/shared/schemas'
import { CardState } from '../../src/shared/srs'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { localDayStart } from '../../src/worker/db/cards'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const MIN = 60_000
const DAY = 86_400_000

type Ctx = ReturnType<typeof setup>

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  const id = await (async () => {
    return ((await (await ctx.as(email, '/api/me')).json()) as MeResponse).decks[0]!.id
  })()
  // These tests cover the Learn path for imported words: use a deck made before importToTrain
  // existed (its imports go to Learn). test/worker/importToTrain.test.ts covers the new default.
  await ctx.as(email, `/api/decks/${id}`, { method: 'PATCH', body: { settings: { importToTrain: false } } })
  return id
}

/** Import + generate: every word becomes a ready New card. Returns term -> card id. */
async function readyDeck(ctx: Ctx, text: string, email = ALICE) {
  const deck = await deckOf(ctx, email)
  expect((await ctx.as(email, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang: 'target' } })).status).toBe(200)
  expect((await ctx.as(email, `/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(200)
  const rows = ctx.sqlite.prepare('SELECT id, input_term FROM cards WHERE deck_id = ?').all(deck) as { id: string; input_term: string }[]
  return { deck, ids: Object.fromEntries(rows.map((r) => [r.input_term, r.id])) as Record<string, string> }
}

async function setDailyLimit(ctx: Ctx, deck: string, n: number) {
  expect((await ctx.as(ALICE, `/api/decks/${deck}`, { method: 'PATCH', body: { settings: { dailyNewLimit: n } } })).status).toBe(200)
}

async function learn(ctx: Ctx, deck: string, query = '', email = ALICE) {
  const res = await ctx.as(email, `/api/decks/${deck}/learn${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as LearnQueueResponse
}

function review(cardId: string, over: Partial<ReviewInput> = {}): ReviewInput {
  return { id: crypto.randomUUID(), cardId, rating: 3, direction: 'target-source', reviewedAt: Date.now(), durationMs: 900, ...over }
}

async function post(ctx: Ctx, body: ReviewInput) {
  const res = await ctx.as(ALICE, '/api/reviews', { method: 'POST', body })
  expect(res.status).toBe(200)
  return (await res.json()) as ReviewResponse
}

const WORDS = 'Hund\nKatze\nHaus\nWasser\ngehen\nessen\ngroß'

/** A tzOffset whose local midnight was `minutesAgo` (+ <1) minutes before `now`. */
function tzWithMidnightAgo(now: number, minutesAgo: number): number {
  const utcMinutes = Math.floor((now % DAY) / MIN)
  let tz = utcMinutes - minutesAgo // local time = UTC - tz  ->  local minutes = minutesAgo
  while (tz > 720) tz -= 1440
  while (tz < -720) tz += 1440
  return tz
}

describe('GET /api/decks/:id/learn', () => {
  it('returns ready New cards oldest first, with counts, capped at dailyNewLimit', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, WORDS)
    // Make the order explicit: reverse the import order.
    const terms = WORDS.split('\n')
    terms.forEach((t, i) => ctx.sqlite.prepare('UPDATE cards SET created_at = ? WHERE id = ?').run(1_000_000 - i, ids[t]))
    await setDailyLimit(ctx, deck, 3)
    const r = await learn(ctx, deck)
    expect(r).toMatchObject({ remainingToday: 3, readyNewTotal: 7, newToday: 0, dailyNewLimit: 3 })
    expect(r.cards.map((c) => c.inputTerm)).toEqual(['groß', 'essen', 'gehen'])
    expect(r.cards[0]).toMatchObject({ status: 'ready', state: CardState.New, alsoInDeck: [] })
    expect((await learn(ctx, deck, '?limit=2')).cards).toHaveLength(2)
  })

  it('excludes every non-ready status and cards already studied', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, WORDS)
    // A real duplicate: "large" resolves to groß.
    await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'large', inputLang: 'source' } })
    await ctx.as(ALICE, `/api/decks/${deck}/generate`, { method: 'POST' })
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM cards WHERE status = 'duplicate'").get()).toEqual({ n: 1 })
    ctx.sqlite.prepare("UPDATE cards SET status = 'pending' WHERE id = ?").run(ids.Hund)
    ctx.sqlite.prepare("UPDATE cards SET status = 'failed' WHERE id = ?").run(ids.Katze)
    ctx.sqlite.prepare("UPDATE cards SET status = 'suspended' WHERE id = ?").run(ids.Haus)
    await ctx.as(ALICE, `/api/cards/${ids.Wasser}`, { method: 'DELETE' })
    await post(ctx, review(ids.gehen!)) // studied: Learning

    const r = await learn(ctx, deck)
    expect(r.cards.map((c) => c.inputTerm)).toEqual(['essen', 'groß'])
    expect(r).toMatchObject({ readyNewTotal: 2, newToday: 1, remainingToday: 9 })
  })

  it("respects the daily limit across the user's local-day boundary (tzOffset)", async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, WORDS)
    await setDailyLimit(ctx, deck, 3)
    const a = await post(ctx, review(ids.Hund!))
    const b = await post(ctx, review(ids.Katze!))
    expect(a.applied && b.applied).toBe(true)
    const now = Date.now()
    // Hund was first studied 30 minutes ago, Katze 5 minutes ago.
    const setLog = (cardId: string, at: number) => ctx.sqlite.prepare('UPDATE review_logs SET reviewed_at = ? WHERE card_id = ?').run(at, cardId)
    setLog(ids.Hund!, now - 30 * MIN)
    setLog(ids.Katze!, now - 5 * MIN)

    // Local midnight was 15 minutes ago: only Katze counts as today.
    const tzLate = tzWithMidnightAgo(now, 15)
    expect(localDayStart(now, tzLate)).toBeLessThanOrEqual(now - 15 * MIN)
    expect(localDayStart(now, tzLate)).toBeGreaterThan(now - 30 * MIN)
    const late = await learn(ctx, deck, `?tzOffset=${tzLate}`)
    expect(late).toMatchObject({ newToday: 1, remainingToday: 2, readyNewTotal: 5 })
    expect(late.cards).toHaveLength(2)

    // An hour further west (local midnight 23h15m ago): both count.
    const tzEarly = tzWithMidnightAgo(now, 15 + 60)
    const early = await learn(ctx, deck, `?tzOffset=${tzEarly}`)
    expect(early).toMatchObject({ newToday: 2, remainingToday: 1 })
    expect(early.cards).toHaveLength(1)

    // Stats count the same thing.
    const stats = ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats?tzOffset=${tzLate}`)).json()) as { stats: DeckStats }).stats
    expect(stats.newToday).toBe(1)

    expect((await ctx.as(ALICE, `/api/decks/${deck}/learn?tzOffset=9999`)).status).toBe(400)
  })

  it('extra=N bypasses the daily cap ("learn more anyway") and still reports remainingToday = 0', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, WORDS)
    await setDailyLimit(ctx, deck, 1)
    await post(ctx, review(ids.Hund!))
    const capped = await learn(ctx, deck)
    expect(capped).toMatchObject({ cards: [], remainingToday: 0, readyNewTotal: 6, newToday: 1 })

    const more = await learn(ctx, deck, '?extra=5')
    expect(more.cards).toHaveLength(5)
    expect(more.remainingToday).toBe(0)
    expect(more.cards.map((c) => c.inputTerm)).toEqual(['Katze', 'Haus', 'Wasser', 'gehen', 'essen'])
    expect((await learn(ctx, deck, '?extra=50')).cards).toHaveLength(6) // only 6 are ready
    expect((await learn(ctx, deck, '?extra=3&limit=2')).cards).toHaveLength(2)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/learn?extra=0`)).status).toBe(400)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/learn?extra=51`)).status).toBe(400)
  })

  it('dailyNewLimit 0 gives nothing without extra', async () => {
    const ctx = setup()
    const { deck } = await readyDeck(ctx, 'Hund')
    await setDailyLimit(ctx, deck, 0)
    expect(await learn(ctx, deck)).toMatchObject({ cards: [], remainingToday: 0, readyNewTotal: 1 })
    expect((await learn(ctx, deck, '?extra=1')).cards).toHaveLength(1)
  })

  it('learning 5 cards with Good moves them to Learning, then Review, with future due dates', async () => {
    const ctx = setup()
    const { deck } = await readyDeck(ctx, WORDS)
    const { cards } = await learn(ctx, deck, '?limit=5')
    expect(cards).toHaveLength(5)
    const t0 = Date.now()
    for (const c of cards) {
      const r = await post(ctx, review(c.id, { reviewedAt: t0 }))
      expect(r.card.srs.state).toBe(CardState.Learning)
      expect(r.card.srs.due).toBeGreaterThan(t0)
    }
    // Nothing of these is New any more: /learn moves on, stats count them as new today.
    const after = await learn(ctx, deck)
    expect(after.cards.map((c) => c.id)).not.toContain(cards[0]!.id)
    expect(after).toMatchObject({ newToday: 5, remainingToday: 5, readyNewTotal: 2 })
    // The 10-minute step is within the learn-ahead: they show in /review.
    const due = (await (await ctx.as(ALICE, `/api/decks/${deck}/review`)).json()) as ReviewQueueResponse
    expect(due.cards.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort())

    // The second Good (in the session's requeue) graduates them to Review, a day or more away.
    for (const c of cards) {
      const r = await post(ctx, review(c.id))
      expect(r.card.srs.state).toBe(CardState.Review)
      expect(r.card.srs.due).toBeGreaterThan(Date.now() + DAY / 2)
    }
    const stats = ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats`)).json()) as { stats: DeckStats }).stats
    expect(stats).toMatchObject({ new: 2, review: 5, learning: 0, newToday: 5, reviewedToday: 10 })
  })

  it('"I already know this" (Easy) on a New card schedules it days out', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund')
    const t = Date.now()
    const r = await post(ctx, review(ids.Hund!, { rating: 4, reviewedAt: t }))
    expect(r.card.srs.state).toBe(CardState.Review)
    expect(r.card.srs.scheduled_days).toBeGreaterThanOrEqual(2)
    expect(r.card.srs.due).toBeGreaterThanOrEqual(t + 2 * DAY)
    expect((await learn(ctx, deck)).cards).toEqual([])
  })

  it('cards carry alsoInDeck (beginnen / anfangen)', async () => {
    const generator = new FakeGenerator({
      lexicon: {
        'target:beginnen': { lemma: 'beginnen', pos: 'verb', translation: 'to begin', example: ['Der Film [[beginnt]] um acht.', 'The film [[begins]] at eight.'] },
        'target:anfangen': { lemma: 'anfangen', pos: 'verb', translation: 'begin', alts: ['start'], example: ['Wir [[fangen]] jetzt [[an]].', 'We [[begin]] now.'] },
      },
    })
    const ctx = setup({}, { generator })
    const { deck, ids } = await readyDeck(ctx, 'beginnen\nanfangen\nHund')
    const by = Object.fromEntries((await learn(ctx, deck)).cards.map((c) => [c.id, c]))
    expect(by[ids.beginnen!]!.alsoInDeck).toEqual([{ id: ids.anfangen, display: 'anfangen' }])
    expect(by[ids.anfangen!]!.alsoInDeck).toEqual([{ id: ids.beginnen, display: 'beginnen' }])
    expect(by[ids.Hund!]!.alsoInDeck).toEqual([])
  })

  it("404 for another user's deck", async () => {
    const ctx = setup()
    const { deck } = await readyDeck(ctx, 'Hund')
    expect((await ctx.as(BOB, `/api/decks/${deck}/learn`)).status).toBe(404)
  })

  it('statement budget: at most 5 D1 statements with cards, 3 when capped (auth included)', async () => {
    const ctx = setup()
    const { deck } = await readyDeck(ctx, WORDS)
    const full = await ctx.countQueries(() => ctx.as(ALICE, `/api/decks/${deck}/learn?limit=50&tzOffset=-60`))
    expect(full.result.status).toBe(200)
    expect(((await full.result.json()) as LearnQueueResponse).cards).toHaveLength(7)
    expect(full.queries).toBeLessThanOrEqual(5)
    await setDailyLimit(ctx, deck, 0)
    const capped = await ctx.countQueries(() => ctx.as(ALICE, `/api/decks/${deck}/learn`))
    expect(capped.queries).toBeLessThanOrEqual(3)
    const extra = await ctx.countQueries(() => ctx.as(ALICE, `/api/decks/${deck}/learn?extra=5`))
    expect(extra.queries).toBeLessThanOrEqual(5)
  })
})
