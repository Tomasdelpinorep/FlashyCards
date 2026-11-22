import { describe, expect, it } from 'vitest'
import type { CardDTO, CardListResponse, DeckStats, GenerateResponse, ImportResponse, MeResponse } from '../../src/shared/schemas'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { GeneratorError } from '../../src/worker/ai/generator'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

type Ctx = ReturnType<typeof setup>

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  const res = await ctx.as(email, '/api/me')
  return ((await res.json()) as MeResponse).decks[0]!.id
}

async function importText(ctx: Ctx, deckId: string, text: string, inputLang: 'target' | 'source' | 'auto' = 'target', email = ALICE) {
  const res = await ctx.as(email, `/api/decks/${deckId}/import`, { method: 'POST', body: { text, inputLang } })
  expect(res.status).toBe(200)
  return (await res.json()) as ImportResponse
}

async function generate(ctx: Ctx, deckId: string, email = ALICE): Promise<GenerateResponse> {
  const res = await ctx.as(email, `/api/decks/${deckId}/generate`, { method: 'POST' })
  expect(res.status).toBe(200)
  return (await res.json()) as GenerateResponse
}

async function cards(ctx: Ctx, deckId: string, query = '', email = ALICE): Promise<CardDTO[]> {
  const res = await ctx.as(email, `/api/decks/${deckId}/cards${query}`)
  return ((await res.json()) as CardListResponse).cards
}

async function stats(ctx: Ctx, deckId: string): Promise<DeckStats> {
  return ((await (await ctx.as(ALICE, `/api/decks/${deckId}/stats`)).json()) as { stats: DeckStats }).stats
}

const fakeOf = (ctx: Ctx) => ctx.generator as FakeGenerator
const row = (ctx: Ctx, where: string) => ctx.sqlite.prepare(`SELECT * FROM cards WHERE ${where}`).get() as Record<string, unknown>
const scalar = (ctx: Ctx, sql: string) => Object.values(ctx.sqlite.prepare(sql).get() as object)[0]

/** A gate the test opens by hand, for interleaving parallel /generate calls. */
function deferred() {
  let open!: () => void
  const promise = new Promise<void>((r) => (open = r))
  return { promise, open }
}

describe('POST /api/decks/:id/generate', () => {
  it('generates pending cards in one batched AI call and stores entries, aliases and glosses', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze\nging')
    const res = await generate(ctx, deck)
    expect(res).toEqual({ processed: 3, fromCache: 0, generated: 3, failed: 0, remaining: 0, rateLimited: false, duplicates: [] })
    expect(fakeOf(ctx).calls).toHaveLength(1)
    expect(fakeOf(ctx).calls[0]!).toMatchObject({ sourceLang: 'en', targetLang: 'de', level: 'A1-A2' })

    const list = await cards(ctx, deck)
    const hund = list.find((c) => c.inputTerm === 'Hund')!
    expect(hund).toMatchObject({ status: 'ready', display: 'der Hund', translation: 'dog', genError: null })
    expect(hund.content).toMatchObject({
      lemma: 'Hund',
      pos: 'noun',
      grammar: { gender: 'masculine', article: 'der', plural: 'die Hunde' },
      exampleTarget: 'Der [[Hund]] spielt im Garten.',
      exampleSource: 'The [[dog]] is playing in the garden.',
    })
    expect(list.find((c) => c.inputTerm === 'ging')).toMatchObject({ display: 'gehen', translation: 'to go' })

    expect(row(ctx, "input_term = 'ging'")).toMatchObject({ lemma_key: 'gehen', sense_key: '', input_side: 'target', gen_claimed_at: null })
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(3)
    expect(ctx.sqlite.prepare("SELECT model, prompt_version FROM entries WHERE lemma = 'gehen'").get()).toEqual({ model: 'fake', prompt_version: 3 })
    const aliases = ctx.sqlite.prepare("SELECT input_side, alias_key FROM entry_aliases ORDER BY alias_key").all()
    expect(aliases).toEqual([
      { input_side: 'target', alias_key: 'gehen' },
      { input_side: 'target', alias_key: 'ging' },
      { input_side: 'target', alias_key: 'hund' },
      { input_side: 'target', alias_key: 'katze' },
    ])
    const glosses = ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ? ORDER BY gloss_key').all(hund.id)
    expect(glosses).toEqual([{ gloss_key: 'dog' }, { gloss_key: 'hound' }])
    expect(ctx.sqlite.prepare('SELECT scope, words, calls FROM ai_usage ORDER BY scope').all()).toEqual([
      { scope: 'global', words: 3, calls: 1 },
      { scope: expect.stringMatching(/^user:/), words: 3, calls: 1 },
    ])
    // Nothing left: a further call does nothing.
    expect(await generate(ctx, deck)).toMatchObject({ processed: 0, remaining: 0 })
    expect(fakeOf(ctx).calls).toHaveLength(1)
  })

  it('handles at most 10 cards per call and reports what remains', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, Array.from({ length: 13 }, (_, i) => `Wort${'abcdefghijklm'[i]}`).join('\n'))
    expect(await generate(ctx, deck)).toMatchObject({ processed: 10, generated: 10, remaining: 3 })
    expect(await generate(ctx, deck)).toMatchObject({ processed: 3, remaining: 0 })
    expect(fakeOf(ctx).calls.map((c) => c.items.length)).toEqual([10, 3])
  })

  it('cache hit: a pending card whose word another user generated meanwhile costs no AI call', async () => {
    const ctx = setup()
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'Hund')
    await importText(ctx, bob, 'Hund', 'target', BOB)
    await generate(ctx, bob, BOB)
    const res = await generate(ctx, alice)
    expect(res).toMatchObject({ processed: 1, fromCache: 1, generated: 0 })
    expect(fakeOf(ctx).calls).toHaveLength(1)
    // Cache hits do not count against the budget.
    expect(ctx.sqlite.prepare("SELECT words FROM ai_usage WHERE scope = 'global'").get()).toEqual({ words: 1 })
  })

  it('a second user importing the same words makes 0 AI calls (import-time alias hits)', async () => {
    const ctx = setup()
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'Hund\nKatze\ngehen\nging')
    await generate(ctx, alice)
    const calls = fakeOf(ctx).calls.length
    const res = await importText(ctx, bob, 'Hund\nKatze\ngehen', 'target', BOB)
    expect(res).toMatchObject({ added: 3, ready: 3, pending: 0 })
    expect(await generate(ctx, bob, BOB)).toMatchObject({ processed: 0, remaining: 0 })
    expect(fakeOf(ctx).calls).toHaveLength(calls)
  })

  it('alias hit (ging -> gehen): Bob cached ging; Alice, who has gehen, imports ging -> import-time duplicate, 0 AI calls', async () => {
    const ctx = setup()
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'gehen')
    await generate(ctx, alice)
    await importText(ctx, bob, 'ging', 'target', BOB)
    await generate(ctx, bob, BOB)
    expect(scalar(ctx, "SELECT COUNT(*) FROM entries WHERE lemma = 'gehen'")).toBe(1)
    const calls = fakeOf(ctx).calls.length

    const before = Number(scalar(ctx, 'SELECT COUNT(*) FROM cards'))
    const res = await importText(ctx, alice, 'ging')
    expect(res).toMatchObject({ added: 0, duplicates: [{ input: 'ging', reason: 'in_deck', existing: { display: 'gehen', status: 'ready' } }] })
    expect(fakeOf(ctx).calls).toHaveLength(calls)
    expect(Number(scalar(ctx, 'SELECT COUNT(*) FROM cards'))).toBe(before)
  })

  it('dog (source) after a ready Hund -> duplicate of Hund, dog added to its extras, entries unchanged', async () => {
    // Hund's cached translation is "hound" here so that "dog" is a new translation for the card.
    const ctx = setup({}, {
      generator: new FakeGenerator({
        lexicon: { 'target:hund': { lemma: 'Hund', pos: 'noun', translation: 'hound', gender: 'masculine', plural: 'die Hunde' } },
      }),
    })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund')
    await generate(ctx, deck)
    const hund = row(ctx, "input_term = 'Hund'")
    const entriesBefore = ctx.sqlite.prepare('SELECT * FROM entries ORDER BY id').all()

    await importText(ctx, deck, 'dog', 'source')
    const res = await generate(ctx, deck)
    expect(res).toMatchObject({ processed: 1, generated: 1, remaining: 0 })
    expect(res.duplicates).toEqual([
      { input: 'dog', reason: 'resolved', existing: { id: hund.id, display: 'der Hund', status: 'ready' }, addedTranslation: 'dog' },
    ])
    expect(row(ctx, "input_term = 'dog'")).toMatchObject({ status: 'duplicate', duplicate_of: hund.id, entry_id: hund.entry_id, lemma_key: 'hund', input_side: 'source' })
    expect(row(ctx, `id = '${hund.id}'`)).toMatchObject({ extra_translations_json: '["dog"]' })
    expect(ctx.sqlite.prepare("SELECT 1 AS ok FROM card_glosses WHERE card_id = ? AND gloss_key = 'dog'").get(hund.id as string)).toEqual({ ok: 1 })
    // The dog card resolved to the existing Hund entry: the global cache is untouched.
    expect(ctx.sqlite.prepare('SELECT * FROM entries ORDER BY id').all()).toEqual(entriesBefore)
    const list = await cards(ctx, deck)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ display: 'der Hund', translation: 'hound', extraTranslations: ['dog'] })
    const dups = await cards(ctx, deck, '?status=duplicate')
    expect(dups).toMatchObject([{ inputTerm: 'dog', duplicateOf: { id: hund.id, display: 'der Hund' } }])
  })

  it('a duplicate whose word is already a gloss adds no translation (dog after Hund = dog)', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund')
    await generate(ctx, deck)
    await importText(ctx, deck, 'dog', 'source')
    const res = await generate(ctx, deck)
    expect(res.duplicates).toMatchObject([{ input: 'dog', addedTranslation: null }])
    expect(row(ctx, "input_term = 'Hund'")).toMatchObject({ extra_translations_json: '[]' })
  })

  it('big + large (both groß) in one batch -> 1 ready card and 1 duplicate', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'big\nlarge', 'source')
    const res = await generate(ctx, deck)
    expect(res).toMatchObject({ processed: 2, generated: 2, remaining: 0 })
    const big = row(ctx, "input_term = 'big'")
    expect(big).toMatchObject({ status: 'ready', lemma_key: 'groß' })
    expect(row(ctx, "input_term = 'large'")).toMatchObject({ status: 'duplicate', duplicate_of: big.id })
    expect(res.duplicates).toMatchObject([{ input: 'large', reason: 'resolved', existing: { id: big.id, display: 'groß' } }])
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(1)
    // Both inputs are now aliases of groß.
    expect(ctx.sqlite.prepare("SELECT alias_key FROM entry_aliases WHERE input_side = 'source' ORDER BY alias_key").all()).toEqual([
      { alias_key: 'big' },
      { alias_key: 'large' },
    ])
  })

  it('plain Bank (-> bank), then Bank;bench -> 2 ready cards; then Bank;bank -> duplicate with addedTranslation null', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Bank')
    await generate(ctx, deck)
    await importText(ctx, deck, 'Bank;bench')
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, duplicates: [] })
    expect(ctx.sqlite.prepare("SELECT input_hint, status, sense_key FROM cards ORDER BY created_at, rowid").all()).toEqual([
      { input_hint: null, status: 'ready', sense_key: '' },
      { input_hint: 'bench', status: 'ready', sense_key: 'bench' },
    ])
    const plain = row(ctx, 'input_hint IS NULL')

    await importText(ctx, deck, 'Bank;bank')
    const res = await generate(ctx, deck)
    expect(res.duplicates).toEqual([
      { input: 'Bank', hint: 'bank', reason: 'resolved', existing: { id: plain.id, display: 'die Bank', status: 'ready' }, addedTranslation: null },
    ])
    expect(row(ctx, "input_hint = 'bank'")).toMatchObject({ status: 'duplicate', duplicate_of: plain.id })
  })

  it('not_a_word -> failed, with the reason', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'asdfgh\nHund')
    const res = await generate(ctx, deck)
    expect(res).toMatchObject({ processed: 2, generated: 1, failed: 1, remaining: 0 })
    expect(row(ctx, "input_term = 'asdfgh'")).toMatchObject({ status: 'failed', gen_error: 'not_a_word', gen_attempts: 1, entry_id: null })
    expect((await cards(ctx, deck, '?status=failed'))[0]).toMatchObject({ inputTerm: 'asdfgh', genError: 'not_a_word', content: null })
  })

  it('429/5xx: the card stays pending and gen_attempts goes up; after 3 attempts it is failed', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund')
    const fake = fakeOf(ctx)
    fake.failNext(new GeneratorError('Rate limited by the AI provider', true, 429)).failNext(new GeneratorError('AI provider error 529', true, 529))
    expect(await generate(ctx, deck)).toMatchObject({ processed: 0, failed: 0, remaining: 1 })
    expect(row(ctx, '1 = 1')).toMatchObject({ status: 'pending', gen_attempts: 1, gen_claimed_at: null, gen_error: 'Rate limited by the AI provider' })
    expect(await generate(ctx, deck)).toMatchObject({ processed: 0, remaining: 1 })
    expect(row(ctx, '1 = 1')).toMatchObject({ status: 'pending', gen_attempts: 2 })
    fake.failNext(new Error('boom'))
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, failed: 1, remaining: 0 })
    expect(row(ctx, '1 = 1')).toMatchObject({ status: 'failed', gen_attempts: 3, gen_error: 'boom' })

    // retry-failed puts it back with a fresh count, and it then generates.
    const retry = await ctx.as(ALICE, `/api/decks/${deck}/retry-failed`, { method: 'POST' })
    expect(await retry.json()).toEqual({ retried: 1 })
    expect(row(ctx, '1 = 1')).toMatchObject({ status: 'pending', gen_attempts: 0, gen_error: null })
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, generated: 1 })
  })

  it('an item missing from the AI response counts as a failed attempt', async () => {
    const fake = new FakeGenerator()
    const original = fake.generate.bind(fake)
    fake.generate = async (req) => (await original(req)).slice(0, 1)
    const ctx = setup({}, { generator: fake })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze')
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, remaining: 1 })
    expect(row(ctx, "input_term = 'Katze'")).toMatchObject({ status: 'pending', gen_attempts: 1, gen_error: 'missing from the response' })
  })

  it('leases: a claimed card is skipped for 90 s, then claimable again', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund')
    ctx.sqlite.prepare('UPDATE cards SET gen_claimed_at = ?').run(Date.now() - 10_000)
    expect(await generate(ctx, deck)).toMatchObject({ processed: 0, remaining: 1 })
    expect(fakeOf(ctx).calls).toHaveLength(0)
    ctx.sqlite.prepare('UPDATE cards SET gen_claimed_at = ?').run(Date.now() - 91_000)
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, remaining: 0 })
  })

  it("returns 404 for another user's deck", async () => {
    const ctx = setup()
    const deck = await deckOf(ctx, ALICE)
    await deckOf(ctx, BOB)
    expect((await ctx.as(BOB, `/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(404)
    expect((await ctx.as(BOB, `/api/decks/${deck}/retry-failed`, { method: 'POST' })).status).toBe(404)
  })
})

describe('generate: rate limit (ai_usage; only cache misses count)', () => {
  it('per-user cutoff: generates up to the limit, then reports rateLimited with limitResetsAt', async () => {
    const ctx = setup({ AI_USER_DAILY_LIMIT: '2' })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze\nHaus\nWasser')
    const first = await generate(ctx, deck)
    const midnight = new Date()
    midnight.setUTCHours(24, 0, 0, 0)
    expect(first).toMatchObject({ processed: 2, generated: 2, remaining: 2, rateLimited: true, limitResetsAt: midnight.getTime() })
    expect(fakeOf(ctx).calls[0]!.items).toHaveLength(2)
    // The rest stay pending, unclaimed, with no attempt counted.
    expect(ctx.sqlite.prepare("SELECT gen_attempts, gen_claimed_at FROM cards WHERE status = 'pending'").all()).toEqual([
      { gen_attempts: 0, gen_claimed_at: null },
      { gen_attempts: 0, gen_claimed_at: null },
    ])
    expect(await generate(ctx, deck)).toMatchObject({ processed: 0, remaining: 2, rateLimited: true })
    expect(fakeOf(ctx).calls).toHaveLength(1)

    // Cache hits still resolve while rate limited: Bob caches Haus, then Alice's Haus is free.
    await importText(ctx, await deckOf(ctx, BOB), 'Haus', 'target', BOB)
    await generate(ctx, await deckOf(ctx, BOB), BOB)
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, fromCache: 1, remaining: 1, rateLimited: true })
  })

  it('global cutoff across users', async () => {
    const ctx = setup({ AI_GLOBAL_DAILY_LIMIT: '3' })
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'Hund\nKatze')
    await importText(ctx, bob, 'Haus\nWasser', 'target', BOB)
    expect(await generate(ctx, alice)).toMatchObject({ generated: 2, rateLimited: false })
    expect(await generate(ctx, bob, BOB)).toMatchObject({ generated: 1, remaining: 1, rateLimited: true })
    expect(ctx.sqlite.prepare("SELECT words, calls FROM ai_usage WHERE scope = 'global'").get()).toEqual({ words: 3, calls: 2 })
  })
})

describe('generate: concurrency', () => {
  it('two parallel /generate calls -> exactly 1 AI call', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze\nHaus\ngehen\nessen')
    const [a, b] = await Promise.all([generate(ctx, deck), generate(ctx, deck)])
    expect(fakeOf(ctx).calls).toHaveLength(1)
    expect(a.processed + b.processed).toBe(5)
    expect(scalar(ctx, "SELECT COUNT(*) FROM cards WHERE status = 'ready'")).toBe(5)
  })

  it('the same lemma resolved by two parallel calls -> 1 ready, 1 duplicate, no constraint error', async () => {
    const gate = deferred()
    const fake = new FakeGenerator({ gate: (_req, i) => (i === 0 ? gate.promise : Promise.resolve()) })
    const ctx = setup({}, { generator: fake })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'big', 'source')
    const first = generate(ctx, deck) // claims "big", then waits in the AI call
    await new Promise((r) => setTimeout(r, 20))
    await importText(ctx, deck, 'large', 'source')
    const second = await generate(ctx, deck) // claims "large" and readies groß first
    expect(second).toMatchObject({ processed: 1, generated: 1, duplicates: [] })
    gate.open()
    const firstRes = await first
    const large = row(ctx, "input_term = 'large'")
    expect(large).toMatchObject({ status: 'ready' })
    expect(firstRes).toMatchObject({ processed: 1, remaining: 0, duplicates: [{ input: 'big', reason: 'resolved', existing: { id: large.id } }] })
    expect(row(ctx, "input_term = 'big'")).toMatchObject({ status: 'duplicate', duplicate_of: large.id, gen_claimed_at: null })
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(1)
    expect(fake.calls).toHaveLength(2)
  })
})

describe('duplicates are excluded from stats and retry-failed', () => {
  it('a duplicate is not counted, and retry-failed leaves it alone', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'big\nlarge\nqqqq', 'source')
    await generate(ctx, deck)
    expect(await stats(ctx, deck)).toMatchObject({ total: 2, ready: 1, failed: 1, pending: 0, new: 1, duplicates: 1 })
    const retry = await ctx.as(ALICE, `/api/decks/${deck}/retry-failed`, { method: 'POST' })
    expect(await retry.json()).toEqual({ retried: 1 })
    expect(row(ctx, "input_term = 'large'")).toMatchObject({ status: 'duplicate' })
    expect((await cards(ctx, deck)).map((c) => c.inputTerm).sort()).toEqual(['big', 'qqqq'])
  })
})

describe('GET /api/cards/:id', () => {
  it('returns the merged content, override_json applied, and alsoInDeck', async () => {
    const ctx = setup({}, {
      generator: new FakeGenerator({
        lexicon: {
          'source:to begin': { lemma: 'beginnen', pos: 'verb', translation: 'to begin', alts: ['to start'] },
          'source:to start': { lemma: 'anfangen', pos: 'verb', translation: 'to start', alts: ['to begin'] },
        },
      }),
    })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'to begin\nto start', 'source')
    await generate(ctx, deck)
    const beginnen = row(ctx, "input_term = 'to begin'")
    ctx.sqlite.prepare('UPDATE cards SET override_json = ? WHERE id = ?').run(JSON.stringify({ exampleTarget: 'Wir [[beginnen]] jetzt.' }), beginnen.id as string)
    const res = await ctx.as(ALICE, `/api/cards/${beginnen.id}`)
    expect(res.status).toBe(200)
    const { card } = (await res.json()) as { card: CardDTO }
    expect(card).toMatchObject({ display: 'beginnen', translation: 'to begin', content: { exampleTarget: 'Wir [[beginnen]] jetzt.' } })
    expect(card.alsoInDeck).toEqual([{ id: row(ctx, "input_term = 'to start'").id, display: 'anfangen' }])
    expect((await ctx.as(BOB, `/api/cards/${beginnen.id}`)).status).toBe(404)
  })
})

describe('D1 query budget (Workers Free: ~50 queries per invocation)', () => {
  it('a 500-row import uses <= 25 statements', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const text = Array.from({ length: 500 }, (_, i) => `Wort${i};word ${i}`).join('\n')
    const { result, queries } = await ctx.countQueries(() => importText(ctx, deck, text))
    expect(result.added).toBe(500)
    expect(queries).toBeLessThanOrEqual(25)
    // Re-importing (500 in-deck duplicates) and a mixed import with merges stay bounded too.
    expect((await ctx.countQueries(() => importText(ctx, deck, text))).queries).toBeLessThanOrEqual(25)
  })

  it('a 500-row import with alias hits and merges uses <= 25 statements', async () => {
    const hund = { lemma: 'Hund', pos: 'noun', translation: 'hound', gender: 'masculine' } as const
    const ctx = setup({}, { generator: new FakeGenerator({ lexicon: { 'target:hund': hund, 'source:dog': hund } }) })
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'Hund\ngroß')
    await generate(ctx, alice)
    await importText(ctx, bob, 'dog\nlarge', 'source', BOB) // caches the source aliases dog -> Hund, large -> groß
    await generate(ctx, bob, BOB)
    const text = ['dog', 'large', ...Array.from({ length: 498 }, (_, i) => `word${i}`)].join('\n')
    const { result, queries } = await ctx.countQueries(() => importText(ctx, alice, text, 'source'))
    expect(result).toMatchObject({ added: 498, pending: 498 })
    expect(result.duplicates).toMatchObject([
      { input: 'dog', reason: 'in_deck', addedTranslation: 'dog' },
      { input: 'large', reason: 'in_deck', addedTranslation: null },
    ])
    expect(queries).toBeLessThanOrEqual(25)
  })

  it('a /generate call over 10 mixed cards (cache hits, misses, duplicates, not_a_word) uses <= 30 statements', async () => {
    const ctx = setup()
    const alice = await deckOf(ctx, ALICE)
    const bob = await deckOf(ctx, BOB)
    await importText(ctx, alice, 'Hund')
    await generate(ctx, alice)
    await importText(ctx, alice, 'dog\nbig\nlarge\nxxxx', 'source')
    await importText(ctx, alice, 'Katze\nHaus\nWasser\nessen\nBank;bench\nBank;bank')
    // Bob caches two of Alice's pending words, so her call has cache hits.
    await importText(ctx, bob, 'Katze\nHaus', 'target', BOB)
    await generate(ctx, bob, BOB)
    const { result, queries, log } = await ctx.countQueries(() => generate(ctx, alice))
    expect(result).toMatchObject({ processed: 10, fromCache: 2, failed: 1 })
    expect(result.duplicates.map((d) => d.input).sort()).toEqual(['dog', 'large'])
    expect(queries, log.join('\n')).toBeLessThanOrEqual(30)
  })

  it('the parallel-race path (phase B) also stays within budget', async () => {
    const gate = deferred()
    const fake = new FakeGenerator({ gate: (_req, i) => (i === 0 ? gate.promise : Promise.resolve()) })
    const ctx = setup({}, { generator: fake })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'big', 'source')
    const counted = ctx.countQueries(() => generate(ctx, deck))
    await new Promise((r) => setTimeout(r, 20))
    const other = (await ctx.countQueries(() => importText(ctx, deck, 'large', 'source'))).queries + (await ctx.countQueries(() => generate(ctx, deck))).queries
    gate.open()
    const { result, queries } = await counted // also counts the interleaved import and generate: subtract them
    expect(result.duplicates).toHaveLength(1) // "big" lost the guard and was resolved in phase B
    expect(queries - other).toBeLessThanOrEqual(30)
  })
})
