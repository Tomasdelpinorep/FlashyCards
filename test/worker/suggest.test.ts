/** M7: POST /decks/:id/suggest ("Add X new words"), docs/DUPLICATES.md 10.7 and 10.9 M7. */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { LANGUAGES } from '../../src/shared/languages'
import { termKey } from '../../src/shared/normalize'
import type { DeckDTO, GenerateResponse, ImportResponse, MeResponse, SuggestResponse } from '../../src/shared/schemas'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
type Ctx = ReturnType<typeof setup>

/** A small German list in rank order (tests do not load the full migration; DECISIONS.md M7). */
const LIST: [lemma: string, pos: string][] = [
  ['Mensch', 'noun'], ['sein', 'verb'], ['Hund', 'noun'], ['Katze', 'noun'], ['Haus', 'noun'],
  ['Wasser', 'noun'], ['gehen', 'verb'], ['essen', 'verb'], ['groß', 'adjective'], ['Bank', 'noun'],
  ['Tisch', 'noun'], ['Stuhl', 'noun'], ['Baum', 'noun'], ['Auto', 'noun'], ['Buch', 'noun'],
  ['Tür', 'noun'], ['Fenster', 'noun'], ['Stadt', 'noun'], ['Land', 'noun'], ['Zeit', 'noun'],
  ['Tag', 'noun'], ['Nacht', 'noun'], ['Freund', 'noun'], ['Mann', 'noun'], ['Frau', 'noun'],
]

function seedList(ctx: Ctx, list = LIST, lang = 'de') {
  const stmt = ctx.sqlite.prepare('INSERT INTO wordlist (lang, rank, lemma, lemma_key, pos) VALUES (?, ?, ?, ?, ?)')
  list.forEach(([lemma, pos], i) => stmt.run(lang, i + 1, lemma, termKey('de', lemma), pos))
}

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  return ((await (await ctx.as(email, '/api/me')).json()) as MeResponse).decks[0]!.id
}

async function suggest(ctx: Ctx, deck: string, count: number, email = ALICE): Promise<SuggestResponse> {
  const res = await ctx.as(email, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count } })
  expect(res.status).toBe(200)
  return (await res.json()) as SuggestResponse
}

async function importText(ctx: Ctx, deck: string, text: string, inputLang: 'target' | 'source' = 'target', email = ALICE) {
  const res = await ctx.as(email, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang } })
  expect(res.status).toBe(200)
  return (await res.json()) as ImportResponse
}

async function generate(ctx: Ctx, deck: string, email = ALICE): Promise<GenerateResponse> {
  const res = await ctx.as(email, `/api/decks/${deck}/generate`, { method: 'POST' })
  expect(res.status).toBe(200)
  return (await res.json()) as GenerateResponse
}

/** input_term of the deck's suggested cards, oldest first. */
const suggested = (ctx: Ctx, deck: string) =>
  (ctx.sqlite.prepare("SELECT input_term FROM cards WHERE deck_id = ? AND origin = 'suggested' ORDER BY created_at, rowid").all(deck) as { input_term: string }[]).map(
    (r) => r.input_term,
  )
const scalar = (ctx: Ctx, sql: string) => Object.values(ctx.sqlite.prepare(sql).get() as object)[0]
const lemmas = (from: number, to: number) => LIST.slice(from - 1, to).map(([l]) => l)

describe('POST /api/decks/:id/suggest (word list)', () => {
  it('adds the next words in rank order as pending suggested cards; 10 twice gives 20 distinct words', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    expect(await suggest(ctx, deck, 10)).toEqual({ added: 10, ready: 0, pending: 10, exhausted: false, duplicates: [] })
    expect(suggested(ctx, deck)).toEqual(lemmas(1, 10))
    const card = ctx.sqlite.prepare("SELECT * FROM cards WHERE input_term = 'Hund'").get() as Record<string, unknown>
    // The POS is NOT the hint: hint_key stays '' so duplicate semantics are those of a plain word.
    expect(card).toMatchObject({ origin: 'suggested', input_lang: 'target', input_hint: null, hint_key: '', term_key: 'hund', status: 'pending' })

    expect(await suggest(ctx, deck, 10)).toMatchObject({ added: 10, exhausted: false })
    const all = suggested(ctx, deck)
    expect(all).toEqual(lemmas(1, 20))
    expect(new Set(all).size).toBe(20)
  })

  it('does not suggest a word imported as "der Hund"', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'der Hund')
    await suggest(ctx, deck, 5)
    expect(suggested(ctx, deck)).toEqual(['Mensch', 'sein', 'Katze', 'Haus', 'Wasser'])
  })

  it('never re-suggests deleted or duplicate cards', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze\nHaus')
    await generate(ctx, deck) // all three ready
    await importText(ctx, deck, 'dog', 'source')
    const g = await generate(ctx, deck) // dog -> duplicate of Hund
    expect(g.duplicates).toHaveLength(1)
    await importText(ctx, deck, 'Wasser') // stays pending
    const id = (term: string) => (ctx.sqlite.prepare('SELECT id FROM cards WHERE input_term = ?').get(term) as { id: string }).id
    for (const term of ['Hund', 'Haus', 'Wasser']) {
      expect((await ctx.as(ALICE, `/api/cards/${id(term)}`, { method: 'DELETE' })).status).toBe(200)
    }
    // Hund: deleted (and the duplicate dog card has lemma_key hund); Haus: deleted after ready;
    // Wasser: deleted while pending (no lemma_key, only its term_key); Katze: ready.
    await suggest(ctx, deck, 4)
    expect(suggested(ctx, deck)).toEqual(['Mensch', 'sein', 'gehen', 'essen'])
  })

  it('does not suggest Hund once "dog" has resolved to Hund', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'dog', 'source')
    await generate(ctx, deck)
    expect(scalar(ctx, "SELECT lemma_key FROM cards WHERE input_term = 'dog'")).toBe('hund')
    await suggest(ctx, deck, 3)
    expect(suggested(ctx, deck)).toEqual(['Mensch', 'sein', 'Katze'])
  })

  it('skipTopN skips the most common words (set through PATCH /decks/:id)', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    const res = await ctx.as(ALICE, `/api/decks/${deck}`, { method: 'PATCH', body: { settings: { skipTopN: 5 } } })
    expect(((await res.json()) as { deck: DeckDTO }).deck.settings.skipTopN).toBe(5)
    await suggest(ctx, deck, 3)
    expect(suggested(ctx, deck)).toEqual(['Wasser', 'gehen', 'essen'])
  })

  it('reports exhausted at the end of the list', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    expect(await suggest(ctx, deck, 20)).toMatchObject({ added: 20, exhausted: false })
    expect(await suggest(ctx, deck, 10)).toMatchObject({ added: 5, exhausted: true })
    expect(await suggest(ctx, deck, 10)).toEqual({ added: 0, ready: 0, pending: 0, exhausted: true, duplicates: [] })
    // Exactly the remaining number: added in full, and nothing is left.
    const ctx2 = setup()
    seedList(ctx2)
    const deck2 = await deckOf(ctx2)
    expect(await suggest(ctx2, deck2, 25)).toMatchObject({ added: 25, exhausted: true })
  })

  it('a word in the shared cache becomes ready at once (alias hit, no AI call)', async () => {
    const ctx = setup()
    seedList(ctx)
    const bobDeck = await deckOf(ctx, BOB)
    await importText(ctx, bobDeck, 'Mensch\nsein', 'target', BOB)
    await generate(ctx, bobDeck, BOB)
    const fake = ctx.generator as FakeGenerator
    const calls = fake.calls.length

    const deck = await deckOf(ctx)
    expect(await suggest(ctx, deck, 3)).toMatchObject({ added: 3, ready: 2, pending: 1 })
    const g = await generate(ctx, deck)
    expect(g).toMatchObject({ processed: 1, fromCache: 0, generated: 1 })
    expect(fake.calls.length).toBe(calls + 1)
    expect(fake.calls.at(-1)!.items.map((i) => i.input)).toEqual(['Hund'])
  })

  it('/generate sends the word-list POS to the model (not as a hint) and reports duplicates found after the AI step', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'dog', 'source') // pending: its lemma is not known yet, so Hund can still be suggested
    expect(await suggest(ctx, deck, 3)).toMatchObject({ added: 3, duplicates: [] })
    expect(suggested(ctx, deck)).toEqual(['Mensch', 'sein', 'Hund'])

    const g = await generate(ctx, deck)
    const call = (ctx.generator as FakeGenerator).calls[0]!
    expect(call.items.find((i) => i.input === 'Hund')).toEqual({ input: 'Hund', hint: null, inputLang: 'target', pos: 'noun' })
    expect(call.items.find((i) => i.input === 'dog')).toEqual({ input: 'dog', hint: null, inputLang: 'source' })

    const dogId = scalar(ctx, "SELECT id FROM cards WHERE input_term = 'dog'")
    expect(g.duplicates).toEqual([
      { input: 'Hund', reason: 'resolved', existing: { id: dogId, display: 'der Hund', status: 'ready' }, addedTranslation: null },
    ])
    expect(scalar(ctx, "SELECT status FROM cards WHERE input_term = 'Hund'")).toBe('duplicate')
  })

  it('validates the body and checks ownership', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    for (const body of [{ count: 0 }, { count: 51 }, { count: 2.5 }, {}, { count: 5, extra: 1 }]) {
      expect((await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body })).status).toBe(400)
    }
    expect((await ctx.as(BOB, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 5 } })).status).toBe(404)
  })

  it('stays within the statement budget', async () => {
    const ctx = setup()
    seedList(ctx)
    const deck = await deckOf(ctx)
    const { queries, log } = await ctx.countQueries(() => suggest(ctx, deck, 50))
    // auth 1 + deck 1 + word list 1 + aliases 1 + candidates 1 + insert batch 1 = 6.
    expect(queries, log.join('\n')).toBeLessThanOrEqual(8)
  })

  it('works on the German deck without AI configured (the word list needs no AI)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = setup({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined }, { generator: 'env' })
    seedList(ctx)
    const deck = await deckOf(ctx)
    expect(await suggest(ctx, deck, 2)).toMatchObject({ added: 2 })
    err.mockRestore()
  })

  it('uses the bundled German list when its migration is applied, minus the skip list', async () => {
    const ctx = setup({}, { wordlists: true })
    const deck = await deckOf(ctx)
    await suggest(ctx, deck, 5)
    const skip = new Set(LANGUAGES.de.suggestSkipLemmas)
    const top = (JSON.parse(readFileSync('data/wordlists/de.json', 'utf8')) as { items: { lemma: string }[] }).items.filter((i) => !skip.has(i.lemma)).slice(0, 5)
    expect(suggested(ctx, deck)).toEqual(top.map((i) => i.lemma))
  })

  it('never suggests the skip list (ich, sie, der, ...)', async () => {
    const ctx = setup()
    seedList(ctx, [['ich', 'pronoun'], ['sie', 'pronoun'], ['Hund', 'noun'], ['man', 'pronoun'], ['Katze', 'noun']])
    const deck = await deckOf(ctx)
    expect(await suggest(ctx, deck, 5)).toMatchObject({ added: 2, exhausted: true })
    expect(suggested(ctx, deck)).toEqual(['Hund', 'Katze'])
  })
})

describe('POST /api/decks/:id/suggest (AI fallback, no word list)', () => {
  async function spanishDeck(ctx: Ctx): Promise<string> {
    const res = await ctx.as(ALICE, '/api/decks', { method: 'POST', body: { name: 'Spanish', sourceLang: 'en', targetLang: 'es' } })
    expect(res.status).toBe(201)
    return ((await res.json()) as { deck: DeckDTO }).deck.id
  }

  it('asks the generator for count x 1.2 words, excluding the deck, and inserts them as suggested', async () => {
    const fake = new FakeGenerator({ suggestPool: ['perro', 'gato', 'casa', 'agua', 'comer', 'ir', 'grande', 'mesa', 'silla', 'libro', 'puerta', 'ciudad', 'tiempo'].map((lemma) => ({ lemma, pos: 'noun' })) })
    const ctx = setup({}, { generator: fake })
    const deck = await spanishDeck(ctx)
    expect(await suggest(ctx, deck, 5)).toMatchObject({ added: 5, pending: 5, exhausted: false })
    expect(fake.suggestCalls[0]).toEqual({ sourceLang: 'en', targetLang: 'es', level: 'A1-A2', count: 6, exclude: [] })
    expect(suggested(ctx, deck)).toEqual(['perro', 'gato', 'casa', 'agua', 'comer'])

    await suggest(ctx, deck, 5)
    expect(new Set(fake.suggestCalls[1]!.exclude)).toEqual(new Set(['perro', 'gato', 'casa', 'agua', 'comer']))
    expect(suggested(ctx, deck).slice(5)).toEqual(['ir', 'grande', 'mesa', 'silla', 'libro'])
    // Each suggestion call costs 1 word + 1 call of the daily budget.
    expect(ctx.sqlite.prepare("SELECT words, calls FROM ai_usage WHERE scope = 'global'").get()).toEqual({ words: 2, calls: 2 })
  })

  it('filters what the model returns against the deck (any status, articles stripped, deduplicated)', async () => {
    const pool = ['el perro', 'Perro', 'gato', 'casa', 'agua'].map((lemma) => ({ lemma, pos: 'noun' }))
    const fake = new FakeGenerator({ suggestPool: pool, suggestIgnoresExclude: true })
    const ctx = setup({}, { generator: fake })
    const deck = await spanishDeck(ctx)
    await importText(ctx, deck, 'gato')
    // Asks for ceil(4 x 1.2) = 5, keeps 3: fewer than requested is fine (no top-up, DUPLICATES.md 10.7).
    expect(await suggest(ctx, deck, 4)).toMatchObject({ added: 3 })
    expect(suggested(ctx, deck)).toEqual(['perro', 'casa', 'agua'])
  })

  it('fails closed when AI is not configured: 503, nothing written', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = setup({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined }, { generator: 'env' })
    const deck = await spanishDeck(ctx)
    const res = await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 5 } })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_not_configured', message: "AI isn't configured on the server" })
    expect(scalar(ctx, 'SELECT COUNT(*) FROM cards')).toBe(0)
    expect(scalar(ctx, 'SELECT COUNT(*) FROM ai_usage')).toBe(0)
    err.mockRestore()
  })

  it('respects the daily AI limit (429 with limitResetsAt)', async () => {
    const ctx = setup({ AI_USER_DAILY_LIMIT: '0' })
    const deck = await spanishDeck(ctx)
    const res = await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 5 } })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'rate_limited', limitResetsAt: expect.any(Number) })
    expect((ctx.generator as FakeGenerator).suggestCalls).toHaveLength(0)
  })

  it('a failed AI call is a 503 ai_unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = new FakeGenerator().failNext(new Error('boom'))
    const ctx = setup({}, { generator: fake })
    const deck = await spanishDeck(ctx)
    const res = await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 5 } })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'ai_unavailable' })
    warn.mockRestore()
  })

  it('stays within the statement budget', async () => {
    const ctx = setup()
    const deck = await spanishDeck(ctx)
    const { queries, log } = await ctx.countQueries(() => suggest(ctx, deck, 50))
    // auth + deck + budget check + known keys + budget consume + filter + aliases + candidates + insert = 9.
    expect(queries, log.join('\n')).toBeLessThanOrEqual(11)
  })
})
