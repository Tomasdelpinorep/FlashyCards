import { describe, expect, it } from 'vitest'
import { glossKey } from '../../src/shared/normalize'
import type { DeckStats, MeResponse, ReviewInput, ReviewQueueResponse, ReviewResponse } from '../../src/shared/schemas'
import { CardState, LEARN_AHEAD_MS, loadSrs, type SrsFields } from '../../src/shared/srs'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { localDayStart } from '../../src/worker/db/cards'
import { clampReviewedAt, submitReview } from '../../src/worker/db/reviews'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const DAY = 86_400_000

type Ctx = ReturnType<typeof setup>

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  return ((await (await ctx.as(email, '/api/me')).json()) as MeResponse).decks[0]!.id
}

/** Import + generate: every word becomes a ready New card. Returns term -> card id. */
async function readyDeck(ctx: Ctx, text: string, email = ALICE) {
  const deck = await deckOf(ctx, email)
  expect((await ctx.as(email, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang: 'target' } })).status).toBe(200)
  expect((await ctx.as(email, `/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(200)
  const rows = ctx.sqlite.prepare('SELECT id, input_term FROM cards WHERE deck_id = ?').all(deck) as { id: string; input_term: string }[]
  return { deck, ids: Object.fromEntries(rows.map((r) => [r.input_term, r.id])) as Record<string, string> }
}

function review(cardId: string, over: Partial<ReviewInput> = {}): ReviewInput {
  return { id: crypto.randomUUID(), cardId, rating: 3, direction: 'target-source', reviewedAt: Date.now(), durationMs: 1200, ...over }
}

async function post(ctx: Ctx, body: unknown, email = ALICE) {
  return ctx.as(email, '/api/reviews', { method: 'POST', body })
}

const cardRow = (ctx: Ctx, id: string) => ctx.sqlite.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Record<string, unknown>
const logCount = (ctx: Ctx, where = '1') => (ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM review_logs WHERE ${where}`).get() as { n: number }).n

/** Put a card straight into Review state (last seen 10 days ago), due at `due`. */
function makeReviewCard(ctx: Ctx, id: string, due = Date.now()) {
  ctx.sqlite
    .prepare(
      `UPDATE cards SET state = 2, stability = 10, difficulty = 5, reps = 4, lapses = 0, scheduled_days = 10,
         learning_steps = 0, last_review = ?, due = ? WHERE id = ?`,
    )
    .run(due - 10 * DAY, due, id)
}

function srsOf(ctx: Ctx, id: string): SrsFields {
  const r = cardRow(ctx, id)
  return {
    due: r.due as number,
    stability: r.stability as number,
    difficulty: r.difficulty as number,
    elapsed_days: r.elapsed_days as number,
    scheduled_days: r.scheduled_days as number,
    learning_steps: r.learning_steps as number,
    reps: r.reps as number,
    lapses: r.lapses as number,
    state: r.state as number,
    last_review: (r.last_review as number | null) ?? null,
  }
}

describe('POST /api/reviews', () => {
  it('applies a rating to a ready New card, logs it with the direction shown, and returns the schedule', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const body = review(ids.Hund!, { direction: 'source-target' })
    const res = await post(ctx, body)
    expect(res.status).toBe(200)
    const json = (await res.json()) as ReviewResponse
    expect(json.applied).toBe(true)
    expect(json.card).toMatchObject({ id: ids.Hund, status: 'ready', srs: { state: CardState.Learning, reps: 1, due: body.reviewedAt + 10 * 60_000 } })
    expect(srsOf(ctx, ids.Hund!)).toEqual(json.card.srs)
    expect(ctx.sqlite.prepare('SELECT * FROM review_logs').get()).toMatchObject({
      id: body.id,
      card_id: ids.Hund,
      rating: 3,
      direction: 'source-target',
      state_before: 0,
      scheduled_days: 0,
      reviewed_at: body.reviewedAt,
      duration_ms: 1200,
    })
  })

  it('Good on a review card moves due forward by the expected interval (fuzz off)', async () => {
    const ctx = setup({}, { srs: { enableFuzz: false } })
    const { ids } = await readyDeck(ctx, 'Hund')
    const reviewedAt = Date.now()
    makeReviewCard(ctx, ids.Hund!, reviewedAt - 1000)
    const before = srsOf(ctx, ids.Hund!)
    const res = await post(ctx, review(ids.Hund!, { reviewedAt }))
    expect(res.status).toBe(200)
    const after = srsOf(ctx, ids.Hund!)
    const expected = (await loadSrs({ enableFuzz: false })).review(ids.Hund!, before, 3, reviewedAt).after
    expect(after).toEqual(expected)
    expect(after.scheduled_days).toBeGreaterThan(10)
    expect(after.due).toBe(reviewedAt + after.scheduled_days * DAY)
    expect(after.elapsed_days).toBe(10)
  })

  it('with fuzz on, the interval stays near the unfuzzed one', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const reviewedAt = Date.now()
    makeReviewCard(ctx, ids.Hund!, reviewedAt)
    const base = (await loadSrs({ enableFuzz: false })).review(ids.Hund!, srsOf(ctx, ids.Hund!), 3, reviewedAt).after.scheduled_days
    await post(ctx, review(ids.Hund!, { reviewedAt }))
    const after = srsOf(ctx, ids.Hund!)
    expect(Math.abs(after.scheduled_days - base)).toBeLessThanOrEqual(Math.max(2, Math.ceil(base * 0.15)))
    expect(after.due).toBe(reviewedAt + after.scheduled_days * DAY)
  })

  it('a repeated review id returns the current card and changes nothing', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const body = review(ids.Hund!)
    const first = (await (await post(ctx, body)).json()) as ReviewResponse
    const rowAfterFirst = cardRow(ctx, ids.Hund!)
    const res = await post(ctx, { ...body, rating: 1, reviewedAt: body.reviewedAt + 5000 })
    expect(res.status).toBe(200)
    const second = (await res.json()) as ReviewResponse
    expect(second).toEqual({ card: first.card, applied: false })
    expect(cardRow(ctx, ids.Hund!)).toEqual(rowAfterFirst)
    expect(logCount(ctx)).toBe(1)
  })

  it('two concurrent posts with the same id apply once (deterministic interleaving)', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const userId = (ctx.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(ALICE) as { id: string }).id
    const srs = await loadSrs()
    // Both requests read the card first; only then are their batches let through, one by one.
    const gate = gatedBatches(ctx.env.DB, 2)
    const body = review(ids.Hund!)
    const both = Promise.all([submitReview(gate.db, userId, body, srs), submitReview(gate.db, userId, body, srs)])
    await gate.allWaiting
    gate.open()
    const [a, b] = await both
    expect(a.ok && b.ok).toBe(true)
    const applied = [a, b].map((r) => r.ok && r.response.applied).sort()
    expect(applied).toEqual([false, true])
    expect(cardRow(ctx, ids.Hund!)).toMatchObject({ reps: 1, state: CardState.Learning })
    expect(logCount(ctx)).toBe(1)
  })

  it('two concurrent posts with the same id through the HTTP route apply once', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const body = review(ids.Hund!)
    const [r1, r2] = await Promise.all([post(ctx, body), post(ctx, body)])
    expect([r1.status, r2.status]).toEqual([200, 200])
    const applied = [((await r1.json()) as ReviewResponse).applied, ((await r2.json()) as ReviewResponse).applied].sort()
    expect(applied).toEqual([false, true])
    expect(cardRow(ctx, ids.Hund!)).toMatchObject({ reps: 1 })
    expect(logCount(ctx)).toBe(1)
  })

  it('two concurrent reviews with different ids both apply, in sequence (CAS retry)', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const userId = (ctx.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(ALICE) as { id: string }).id
    const srs = await loadSrs()
    const gate = gatedBatches(ctx.env.DB, 2)
    const t = Date.now()
    const both = Promise.all([
      submitReview(gate.db, userId, review(ids.Hund!, { reviewedAt: t }), srs),
      submitReview(gate.db, userId, review(ids.Hund!, { reviewedAt: t + 1 }), srs),
    ])
    await gate.allWaiting
    gate.open()
    const [a, b] = await both
    expect([a.ok && a.response.applied, b.ok && b.response.applied]).toEqual([true, true])
    expect(cardRow(ctx, ids.Hund!)).toMatchObject({ reps: 2 })
    expect(logCount(ctx)).toBe(2)
  })

  it('clamps reviewedAt to [now - 7 days, now]', async () => {
    expect(clampReviewedAt(1_000, 10 * DAY)).toBe(3 * DAY)
    expect(clampReviewedAt(20 * DAY, 10 * DAY)).toBe(10 * DAY)
    expect(clampReviewedAt(9 * DAY, 10 * DAY)).toBe(9 * DAY)

    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund\nKatze')
    const before = Date.now()
    await post(ctx, review(ids.Hund!, { reviewedAt: before + 3_600_000 })) // 1 h in the future
    await post(ctx, review(ids.Katze!, { reviewedAt: before - 30 * DAY })) // a month late
    const after = Date.now()
    const at = (id: string) => (ctx.sqlite.prepare('SELECT reviewed_at FROM review_logs WHERE card_id = ?').get(id) as { reviewed_at: number }).reviewed_at
    expect(at(ids.Hund!)).toBeGreaterThanOrEqual(before)
    expect(at(ids.Hund!)).toBeLessThanOrEqual(after)
    expect(at(ids.Katze!)).toBeGreaterThanOrEqual(before - 7 * DAY)
    expect(at(ids.Katze!)).toBeLessThanOrEqual(after - 7 * DAY)
    expect(cardRow(ctx, ids.Katze!).last_review).toBe(at(ids.Katze!))
  })

  it('409 for a card that is not ready (pending, failed, suspended, duplicate); nothing is logged', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund\nKatze\nHaus')
    ctx.sqlite.prepare("UPDATE cards SET status = 'suspended' WHERE id = ?").run(ids.Katze)
    ctx.sqlite.prepare("UPDATE cards SET status = 'failed' WHERE id = ?").run(ids.Haus)
    await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Wasser', inputLang: 'target' } })
    const pending = (ctx.sqlite.prepare("SELECT id FROM cards WHERE input_term = 'Wasser'").get() as { id: string }).id
    for (const id of [ids.Katze!, ids.Haus!, pending]) {
      const res = await post(ctx, review(id))
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: 'card_not_ready' })
    }
    expect(logCount(ctx)).toBe(0)
    expect(cardRow(ctx, ids.Katze!)).toMatchObject({ reps: 0, state: 0 })
  })

  it("404 for another user's card, a deleted card and an unknown card", async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund\nKatze')
    expect((await post(ctx, review(ids.Hund!), BOB)).status).toBe(404)
    await ctx.as(ALICE, `/api/cards/${ids.Katze}`, { method: 'DELETE' })
    expect((await post(ctx, review(ids.Katze!))).status).toBe(404)
    expect((await post(ctx, review('no-such-card'))).status).toBe(404)
    expect(logCount(ctx)).toBe(0)
    expect(cardRow(ctx, ids.Hund!)).toMatchObject({ reps: 0 })
  })

  it('409 when a review id is reused for a different card', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund\nKatze')
    const body = review(ids.Hund!)
    await post(ctx, body)
    const res = await post(ctx, { ...body, cardId: ids.Katze })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'review_id_conflict' })
    expect(cardRow(ctx, ids.Katze!)).toMatchObject({ reps: 0 })
  })

  it('400 for an invalid body', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    for (const bad of [
      { ...review(ids.Hund!), id: 'not-a-uuid' },
      { ...review(ids.Hund!), rating: 5 },
      { ...review(ids.Hund!), direction: 'mixed' },
      { ...review(ids.Hund!), extra: 1 },
    ]) {
      expect((await post(ctx, bad)).status).toBe(400)
    }
  })

  it('statement budget: a review costs at most 6 D1 statements (auth included)', async () => {
    const ctx = setup()
    const { ids } = await readyDeck(ctx, 'Hund')
    const body = review(ids.Hund!)
    const first = await ctx.countQueries(() => post(ctx, body))
    expect(first.result.status).toBe(200)
    expect(first.queries).toBeLessThanOrEqual(6)
    const repeat = await ctx.countQueries(() => post(ctx, body))
    expect(repeat.queries).toBeLessThanOrEqual(4)
  })
})

describe('GET /api/decks/:id/review', () => {
  async function queue(ctx: Ctx, deck: string, query = '', email = ALICE) {
    const res = await ctx.as(email, `/api/decks/${deck}/review${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as ReviewQueueResponse
  }

  it('returns ready studied cards due within 20 minutes, soonest first; ahead=1 adds later ones', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund\nKatze\nHaus\nWasser\ngehen\nessen\ngroß')
    const now = Date.now()
    makeReviewCard(ctx, ids.Hund!, now - 60_000) // due
    makeReviewCard(ctx, ids.Katze!, now + LEARN_AHEAD_MS - 60_000) // within learn-ahead
    makeReviewCard(ctx, ids.Haus!, now + 3 * DAY) // later
    makeReviewCard(ctx, ids.Wasser!, now - DAY) // due but suspended
    ctx.sqlite.prepare("UPDATE cards SET status = 'suspended' WHERE id = ?").run(ids.Wasser)
    makeReviewCard(ctx, ids.gehen!, now - DAY) // due but deleted
    await ctx.as(ALICE, `/api/cards/${ids.gehen}`, { method: 'DELETE' })
    makeReviewCard(ctx, ids.essen!, now - DAY) // due but failed
    ctx.sqlite.prepare("UPDATE cards SET status = 'failed' WHERE id = ?").run(ids.essen)
    // groß stays New: never in /review.

    const due = await queue(ctx, deck)
    expect(due.cards.map((c) => c.id)).toEqual([ids.Hund, ids.Katze])
    expect(due.cards[0]).toMatchObject({ status: 'ready', display: 'der Hund', srs: { state: CardState.Review, reps: 4 }, alsoInDeck: [] })
    expect(due.cards[0]!.content?.exampleSource).toContain('[[dog]]')

    const ahead = await queue(ctx, deck, '?ahead=1')
    expect(ahead.cards.map((c) => c.id)).toEqual([ids.Hund, ids.Katze, ids.Haus])
    expect((await queue(ctx, deck, '?ahead=1&limit=1')).cards.map((c) => c.id)).toEqual([ids.Hund])
  })

  it('excludes pending, duplicate and New cards, and reports nextDueAt when nothing is due', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'groß\nHund')
    // "large" resolves to groß: a duplicate card.
    await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'large\nbig', inputLang: 'source' } })
    await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Katze', inputLang: 'target' } }) // stays pending
    const dup = ctx.sqlite.prepare("SELECT id FROM cards WHERE status = 'duplicate'").all() as { id: string }[]
    for (const d of dup) makeReviewCard(ctx, d.id, Date.now() - DAY)
    const pending = (ctx.sqlite.prepare("SELECT id FROM cards WHERE status = 'pending'").get() as { id: string } | undefined)?.id
    if (pending) makeReviewCard(ctx, pending, Date.now() - DAY)

    expect(await queue(ctx, deck)).toEqual({ cards: [], nextDueAt: null }) // only New ready cards
    const later = Date.now() + 2 * DAY
    makeReviewCard(ctx, ids.Hund!, later)
    expect(await queue(ctx, deck)).toEqual({ cards: [], nextDueAt: later })
    expect((await queue(ctx, deck, '?ahead=1')).cards.map((c) => c.id)).toEqual([ids.Hund])
  })

  it("404 for another user's deck", async () => {
    const ctx = setup()
    const { deck } = await readyDeck(ctx, 'Hund')
    expect((await ctx.as(BOB, `/api/decks/${deck}/review`)).status).toBe(404)
  })

  it('beginnen and anfangen list each other in alsoInDeck ("to begin" matches "begin")', async () => {
    expect(glossKey('en', 'to begin')).toBe(glossKey('en', 'begin'))
    const generator = new FakeGenerator({
      lexicon: {
        'target:beginnen': { lemma: 'beginnen', pos: 'verb', translation: 'to begin', example: ['Der Film [[beginnt]] um acht.', 'The film [[begins]] at eight.'] },
        'target:anfangen': { lemma: 'anfangen', pos: 'verb', translation: 'begin', alts: ['start'], example: ['Wir [[fangen]] jetzt [[an]].', 'We [[begin]] now.'] },
      },
    })
    const ctx = setup({}, { generator })
    const { deck, ids } = await readyDeck(ctx, 'beginnen\nanfangen\nHund')
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM cards WHERE status = 'ready'").get()).toEqual({ n: 3 })
    for (const id of Object.values(ids)) await post(ctx, review(id)) // New -> learning, due in 10 min
    const { cards } = await queue(ctx, deck)
    const by = Object.fromEntries(cards.map((c) => [c.id, c]))
    expect(by[ids.beginnen!]!.alsoInDeck).toEqual([{ id: ids.anfangen, display: 'anfangen' }])
    expect(by[ids.anfangen!]!.alsoInDeck).toEqual([{ id: ids.beginnen, display: 'beginnen' }])
    expect(by[ids.Hund!]!.alsoInDeck).toEqual([])
  })

  it('statement budget: at most 5 D1 statements with cards, 5 when empty (auth included)', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund\nKatze\nHaus')
    for (const id of Object.values(ids)) makeReviewCard(ctx, id, Date.now() - 1000)
    const full = await ctx.countQueries(() => ctx.as(ALICE, `/api/decks/${deck}/review?limit=50`))
    expect(full.result.status).toBe(200)
    expect(((await full.result.json()) as ReviewQueueResponse).cards).toHaveLength(3)
    expect(full.queries).toBeLessThanOrEqual(5)
    ctx.sqlite.prepare('UPDATE cards SET due = due + 864000000').run()
    const empty = await ctx.countQueries(() => ctx.as(ALICE, `/api/decks/${deck}/review`))
    expect(empty.queries).toBeLessThanOrEqual(5)
  })
})

describe('GET /api/decks/:id/stats (M5 day counts)', () => {
  it('counts dueNow (with learn-ahead), dueToday, reviewedToday and newToday', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund\nKatze\nHaus\nWasser')
    await post(ctx, review(ids.Hund!)) // New -> learning (10 min): due now with learn-ahead
    await post(ctx, review(ids.Hund!, { rating: 3 })) // second review of the same card today
    await post(ctx, review(ids.Katze!, { rating: 1 })) // New -> learning (1 min)
    makeReviewCard(ctx, ids.Haus!, Date.now() + 10 * DAY) // not due
    const stats = async (q = '') => ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats${q}`)).json()) as { stats: DeckStats }).stats
    const s = await stats()
    expect(s).toMatchObject({ new: 1, reviewedToday: 3, newToday: 2 })
    expect(s.dueNow).toBeGreaterThanOrEqual(1) // Katze (1 min); Hund depends on its second step
    expect(s.dueToday).toBeGreaterThanOrEqual(s.dueNow)
    expect(s.dueToday).toBeLessThanOrEqual(2)
    // Another user's reviews never count.
    expect((await ctx.as(BOB, `/api/decks/${deck}/stats`)).status).toBe(404)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/stats?tzOffset=-120`)).status).toBe(200)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/stats?tzOffset=9999`)).status).toBe(400)
  })

  it('uses the client local day for "today"', async () => {
    const ctx = setup()
    const { deck, ids } = await readyDeck(ctx, 'Hund')
    const now = Date.now()
    // A review logged 1 ms before UTC midnight of today.
    const utcMidnight = localDayStart(now, 0)
    await post(ctx, review(ids.Hund!, { reviewedAt: utcMidnight - 1 }))
    const get = async (tz: number) =>
      ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats?tzOffset=${tz}`)).json()) as { stats: DeckStats }).stats.reviewedToday
    expect(await get(0)).toBe(0) // yesterday in UTC
    // In UTC-1 (tzOffset 60) the local day started an hour after UTC midnight, unless "now" is
    // before that; in UTC+1 (tzOffset -60) it started an hour before UTC midnight: counted.
    expect(await get(-60)).toBe(now - utcMidnight < 23 * 3_600_000 ? 1 : 0)
  })

  it('localDayStart', () => {
    const t = Date.UTC(2026, 10, 21, 0, 30) // 00:30 UTC
    expect(localDayStart(t, 0)).toBe(Date.UTC(2026, 10, 21))
    expect(localDayStart(t, 60)).toBe(Date.UTC(2026, 10, 20, 1)) // UTC-1: still 23:30 on the 20th
    expect(localDayStart(t, -120)).toBe(Date.UTC(2026, 10, 20, 22)) // UTC+2: 02:30 on the 21st
  })
})

/**
 * Wraps a D1 database so that `db.batch` waits until `n` batches are pending, then lets them run
 * one at a time once `open()` is called (D1 serialises writes the same way).
 */
function gatedBatches(db: D1Database, n: number) {
  let waiting = 0
  let release!: () => void
  const opened = new Promise<void>((r) => (release = r))
  let signal!: () => void
  const allWaiting = new Promise<void>((r) => (signal = r))
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'batch') {
        return async (stmts: D1PreparedStatement[]) => {
          waiting++
          if (waiting === n) signal()
          await opened
          return target.batch(stmts)
        }
      }
      const v = Reflect.get(target, prop, receiver) as unknown
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
  return { db: wrapped, allWaiting, open: () => release() }
}
