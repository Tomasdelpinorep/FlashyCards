/**
 * No-AI dictionary (docs/DECISIONS.md): with no generator, /generate serves the curated cache and
 * marks misses needs_meaning; the user fills the meaning (POST /cards/:id/meaning); retry skips
 * those cards; /suggest only offers curated words. The cache is seeded with scripts/curated-to-sql.ts
 * output for a small fixture (the real 0003_seed_de.sql is covered by curated.test.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { termKey } from '../../src/shared/normalize'
import type { CardDTO, CardListResponse, DeckStats, GenerateResponse, LearnQueueResponse, MeResponse, SuggestResponse } from '../../src/shared/schemas'
import { DEV_LEXICON_DE } from '../../src/worker/ai/devLexicon.de'
import { curatedToSql } from '../../scripts/curated-to-sql'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
type Ctx = ReturnType<typeof setup>

const pick = (...lemmas: string[]) => lemmas.map((l) => DEV_LEXICON_DE.find((e) => e.lemma === l)!)
export const FIXTURE = pick('Kind', 'Schule', 'Auto', 'fahren', 'lernen', 'neu', 'sich freuen')
export const FIXTURE_LEMMAS = ['Kind', 'Schule', 'Auto', 'fahren', 'lernen', 'neu', 'freuen']

function seeded(): Ctx {
  const ctx = setup({}, { generator: null })
  ctx.sqlite.exec(curatedToSql(FIXTURE, FIXTURE_LEMMAS).sql)
  return ctx
}

async function deckOf(ctx: Ctx): Promise<string> {
  return ((await (await ctx.as(ALICE, '/api/me')).json()) as MeResponse).decks[0]!.id
}
async function importText(ctx: Ctx, deck: string, text: string, inputLang: 'target' | 'source' | 'auto' = 'target') {
  const res = await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang } })
  expect(res.status).toBe(200)
  return res.json()
}
async function generate(ctx: Ctx, deck: string): Promise<GenerateResponse> {
  const res = await ctx.as(ALICE, `/api/decks/${deck}/generate`, { method: 'POST' })
  expect(res.status).toBe(200)
  return (await res.json()) as GenerateResponse
}
async function cards(ctx: Ctx, deck: string): Promise<CardDTO[]> {
  return ((await (await ctx.as(ALICE, `/api/decks/${deck}/cards`)).json()) as CardListResponse).cards
}
async function stats(ctx: Ctx, deck: string): Promise<DeckStats> {
  return ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats`)).json()) as { stats: DeckStats }).stats
}
const meaning = (ctx: Ctx, id: string, body: unknown) => ctx.as(ALICE, `/api/cards/${id}/meaning`, { method: 'POST', body })
const scalar = (ctx: Ctx, sql: string) => Object.values(ctx.sqlite.prepare(sql).get() as object)[0]

describe('no AI: the curated cache', () => {
  it('serves dictionary words on both sides at once; misses need a meaning (no budget used)', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    // Alias hits are ready at import; "Zwetschge" and "spoon" are not in the dictionary.
    await importText(ctx, deck, 'das Kind\nfreuen\nZwetschge')
    await importText(ctx, deck, 'car\ngo\nspoon', 'source')
    const g = await generate(ctx, deck)
    expect(g).toMatchObject({ processed: 2, fromCache: 0, generated: 0, failed: 2, needsMeaning: 2, remaining: 0, rateLimited: false })
    expect(scalar(ctx, 'SELECT COUNT(*) FROM ai_usage')).toBe(0)
    const list = await cards(ctx, deck)
    const by = (t: string) => list.find((c) => c.inputTerm === t)!
    expect(by('das Kind')).toMatchObject({ status: 'ready', display: 'das Kind', translation: 'child' })
    expect(by('freuen')).toMatchObject({ status: 'ready', display: 'sich freuen' })
    expect(by('car')).toMatchObject({ status: 'ready', display: 'das Auto' })
    expect(by('go')).toMatchObject({ status: 'ready', display: 'fahren' }) // "to go" is an alternative of fahren
    expect(by('Zwetschge')).toMatchObject({ status: 'failed', genError: 'needs_meaning', content: null })
    expect(await stats(ctx, deck)).toMatchObject({ ready: 4, failed: 2, needsMeaning: 2 })
  })

  it('with the real seed migration: dictionary words are ready at import, others need a meaning', async () => {
    const ctx = setup({}, { generator: null, seed: true })
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'das Haus\ngehen\nerinnern\nZwetschge')
    expect(await importText(ctx, deck, 'dog\nto go', 'source')).toMatchObject({ added: 1, duplicates: [{ input: 'to go', existing: { display: 'gehen' } }] })
    expect(await generate(ctx, deck)).toMatchObject({ processed: 1, needsMeaning: 1 })
    const list = await cards(ctx, deck)
    const by = (t: string) => list.find((c) => c.inputTerm === t)!
    expect(by('das Haus')).toMatchObject({ status: 'ready', display: 'das Haus' })
    expect(by('erinnern')).toMatchObject({ status: 'ready', display: 'sich erinnern' })
    expect(by('dog')).toMatchObject({ status: 'ready', display: 'der Hund' })
    expect(by('Zwetschge')).toMatchObject({ status: 'failed', genError: 'needs_meaning' })
    expect(scalar(ctx, "SELECT COUNT(*) FROM entries WHERE model <> 'curated'")).toBe(0)
  })

  it('retry-failed skips needs_meaning cards but retries other failures', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Zwetschge\nQuark')
    await generate(ctx, deck)
    ctx.sqlite.prepare("UPDATE cards SET gen_error = 'not_a_word' WHERE input_term = 'Quark'").run()
    const res = await ctx.as(ALICE, `/api/decks/${deck}/retry-failed`, { method: 'POST' })
    expect(await res.json()).toEqual({ retried: 1 })
    expect(ctx.sqlite.prepare('SELECT input_term, status, gen_error FROM cards ORDER BY input_term').all()).toEqual([
      { input_term: 'Quark', status: 'pending', gen_error: null },
      { input_term: 'Zwetschge', status: 'failed', gen_error: 'needs_meaning' },
    ])
  })
})

describe('the A2 dictionary additions (migrations/0005_seed_de_a2.sql)', () => {
  const migration = (file: string) => readFileSync(join(__dirname, '..', '..', 'migrations', file), 'utf8')

  it('re-queues cards waiting for a meaning; /generate serves the new words and re-marks the rest', async () => {
    const ctx = setup({}, { generator: null })
    ctx.sqlite.exec(migration('0003_seed_de.sql'))
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'müde\nanmelden\nEs tut mir leid\nZwetschge\nQuark')
    expect(await generate(ctx, deck)).toMatchObject({ processed: 5, needsMeaning: 5 })
    // A failed card that already has a user meaning is left alone.
    ctx.sqlite.prepare(`UPDATE cards SET override_json = '{}' WHERE input_term = 'Quark'`).run()

    ctx.sqlite.exec(migration('0005_seed_de_a2.sql'))
    const rows = () => ctx.sqlite.prepare('SELECT input_term, status, gen_error, gen_attempts, gen_claimed_at FROM cards ORDER BY input_term').all()
    expect(rows()).toEqual([
      { input_term: 'Es tut mir leid', status: 'pending', gen_error: null, gen_attempts: 0, gen_claimed_at: null },
      { input_term: 'Quark', status: 'failed', gen_error: 'needs_meaning', gen_attempts: 1, gen_claimed_at: null },
      { input_term: 'Zwetschge', status: 'pending', gen_error: null, gen_attempts: 0, gen_claimed_at: null },
      { input_term: 'anmelden', status: 'pending', gen_error: null, gen_attempts: 0, gen_claimed_at: null },
      { input_term: 'müde', status: 'pending', gen_error: null, gen_attempts: 0, gen_claimed_at: null },
    ])

    expect(await generate(ctx, deck)).toMatchObject({ processed: 4, fromCache: 3, generated: 0, needsMeaning: 1, remaining: 0 })
    const by = (t: string, list: CardDTO[]) => list.find((c) => c.inputTerm === t)!
    const list = await cards(ctx, deck)
    expect(by('müde', list)).toMatchObject({ status: 'ready', display: 'müde', translation: 'tired' })
    expect(by('anmelden', list)).toMatchObject({ status: 'ready', display: 'sich anmelden', translation: 'to register' })
    expect(by('Es tut mir leid', list)).toMatchObject({ status: 'ready', display: 'Es tut mir leid.', content: { pos: 'phrase' } })
    expect(by('Zwetschge', list)).toMatchObject({ status: 'failed', genError: 'needs_meaning' })
  })

  it('the whole A2 import list (148 lines, phrases included) is ready at import', async () => {
    const ctx = setup({}, { generator: null, seed: true })
    const deck = await deckOf(ctx)
    const text = readFileSync(join(__dirname, '..', 'fixtures', 'german-a2-words.txt'), 'utf8')
    expect(await importText(ctx, deck, text)).toMatchObject({ added: 148, duplicates: [], invalid: [] })
    expect(await stats(ctx, deck)).toMatchObject({ ready: 148, pending: 0, failed: 0 })
    const entryOf = ctx.sqlite.prepare('SELECT e.lemma, e.translation FROM cards c JOIN entries e ON e.id = c.entry_id WHERE c.input_term = ?')
    const lemma = (t: string) => ({ ...(entryOf.get(t) as object) })
    expect(lemma('Das macht nichts.')).toEqual({ lemma: 'Das macht nichts.', translation: 'that doesn’t matter' })
    expect(lemma('Einen Moment, bitte.')).toMatchObject({ lemma: 'Einen Moment, bitte.' })
    expect(lemma('die Küche')).toEqual({ lemma: 'Küche', translation: 'kitchen' })
    expect(lemma('sich fühlen')).toMatchObject({ lemma: 'fühlen' })
    expect(lemma('sich anmelden')).toMatchObject({ lemma: 'sich anmelden' })
    expect(lemma('wegen')).toMatchObject({ lemma: 'wegen' }) // already in 0003
  })
})

describe('POST /api/cards/:id/meaning', () => {
  async function failedCard(ctx: Ctx, deck: string, text: string, inputLang: 'target' | 'source' = 'target') {
    await importText(ctx, deck, text, inputLang)
    await generate(ctx, deck)
    return (await cards(ctx, deck)).find((c) => c.inputTerm === text)!
  }

  it('makes the card ready with the user meaning (no shared entry); it shows in Learn', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    const card = await failedCard(ctx, deck, 'Zwetschge')
    const entries = scalar(ctx, 'SELECT COUNT(*) FROM entries')
    const res = await meaning(ctx, card.id, {
      word: 'die Zwetschge',
      translation: 'plum',
      exampleTarget: 'Die [[Zwetschge]] ist reif.',
      exampleSource: 'The [[plum]] is ripe.',
    })
    expect(res.status).toBe(200)
    const { card: c } = (await res.json()) as { card: CardDTO }
    expect(c).toMatchObject({ status: 'ready', display: 'die Zwetschge', translation: 'plum', genError: null })
    expect(c.content).toMatchObject({ lemma: 'Zwetschge', pos: 'noun', grammar: { gender: 'feminine', article: 'die' }, exampleTarget: 'Die [[Zwetschge]] ist reif.' })
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(entries)
    expect(ctx.sqlite.prepare('SELECT entry_id, lemma_key, sense_key, input_side FROM cards WHERE id = ?').get(card.id)).toEqual({
      entry_id: null,
      lemma_key: 'zwetschge',
      sense_key: '',
      input_side: 'target',
    })
    expect(ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ?').all(card.id)).toEqual([{ gloss_key: 'plum' }])
    const learn = (await (await ctx.as(ALICE, `/api/decks/${deck}/learn`)).json()) as LearnQueueResponse
    expect(learn.cards.map((x) => x.display)).toContain('die Zwetschge')
    expect((await stats(ctx, deck)).needsMeaning).toBe(0)
  })

  it('a gender without an article sets the article; sentences without valid markers are kept without them', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    const card = await failedCard(ctx, deck, 'Löffel')
    const res = await meaning(ctx, card.id, { word: 'Löffel', translation: 'spoon', gender: 'masculine', exampleTarget: 'Der [[Löffel ist hier.' })
    const { card: c } = (await res.json()) as { card: CardDTO }
    expect(c).toMatchObject({ display: 'der Löffel', content: { exampleTarget: 'Der Löffel ist hier.', exampleSource: null } })
  })

  it('source-language input keeps the typed word as a gloss', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    const card = await failedCard(ctx, deck, 'spoon', 'source')
    const res = await meaning(ctx, card.id, { word: 'Löffel', translation: 'spoon (cutlery)', gender: 'masculine' })
    expect(res.status).toBe(200)
    expect(ctx.sqlite.prepare('SELECT input_side, lemma_key FROM cards WHERE id = ?').get(card.id)).toEqual({ input_side: 'source', lemma_key: 'löffel' })
    expect(ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ? ORDER BY gloss_key').all(card.id)).toEqual([{ gloss_key: 'spoon' }])
  })

  it('409 already_in_deck when the deck has that word; the card stays failed', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Kind')
    const card = await failedCard(ctx, deck, 'Kindd')
    const res = await meaning(ctx, card.id, { word: 'das Kind', translation: 'child' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'already_in_deck', existing: { display: 'das Kind' } })
    expect(ctx.sqlite.prepare('SELECT status, lemma_key, override_json FROM cards WHERE id = ?').get(card.id)).toEqual({ status: 'failed', lemma_key: null, override_json: null })
    expect(scalar(ctx, `SELECT COUNT(*) FROM card_glosses WHERE card_id = '${card.id}'`)).toBe(0)
  })

  it('409 for a card that is not failed, 404 for another user, 400 without a translation', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Kind')
    const ready = (await cards(ctx, deck))[0]!
    expect((await meaning(ctx, ready.id, { word: 'Kind', translation: 'child' })).status).toBe(409)
    const card = await failedCard(ctx, deck, 'Zwetschge')
    expect((await meaning(ctx, card.id, { word: 'Zwetschge', translation: ' ' })).status).toBe(400)
    const bob = await ctx.as('bob@example.com', `/api/cards/${card.id}/meaning`, { method: 'POST', body: { word: 'Zwetschge', translation: 'plum' } })
    expect(bob.status).toBe(404)
  })

  it('PATCH can edit the user meaning but not clear its translation', async () => {
    const ctx = seeded()
    const deck = await deckOf(ctx)
    const card = await failedCard(ctx, deck, 'Zwetschge')
    await meaning(ctx, card.id, { word: 'Zwetschge', translation: 'plum', gender: 'feminine' })
    const clear = await ctx.as(ALICE, `/api/cards/${card.id}`, { method: 'PATCH', body: { translation: '' } })
    expect(clear.status).toBe(400)
    const edit = await ctx.as(ALICE, `/api/cards/${card.id}`, { method: 'PATCH', body: { translation: 'damson' } })
    expect(edit.status).toBe(200)
    expect(((await edit.json()) as { card: CardDTO }).card).toMatchObject({ display: 'die Zwetschge', translation: 'damson' })
    expect(ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ?').all(card.id)).toEqual([{ gloss_key: 'damson' }])
  })
})

describe('POST /api/decks/:id/suggest with the curated filter', () => {
  function seedList(ctx: Ctx, list: string[]) {
    const stmt = ctx.sqlite.prepare("INSERT INTO wordlist (lang, rank, lemma, lemma_key, pos) VALUES ('de', ?, ?, ?, 'other')")
    list.forEach((lemma, i) => stmt.run(i + 1, lemma, termKey('de', lemma)))
  }

  it('suggests only curated, non-skipped words, all ready at once, then reports exhaustion', async () => {
    const ctx = seeded()
    seedList(ctx, ['ich', 'Kind', 'Zwetschge', 'sie', 'Schule', 'freuen', 'Löffel', 'Auto'])
    const deck = await deckOf(ctx)
    const first = (await (await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 3 } })).json()) as SuggestResponse
    expect(first).toMatchObject({ added: 3, ready: 3, pending: 0, exhausted: false })
    const second = (await (await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 3 } })).json()) as SuggestResponse
    expect(second).toMatchObject({ added: 1, ready: 1, exhausted: true })
    expect((await cards(ctx, deck)).map((c) => c.display).sort()).toEqual(['das Auto', 'das Kind', 'die Schule', 'sich freuen'])
  })

  it('falls back to the whole list when the pair has no curated entries', async () => {
    const ctx = setup({}, { generator: null })
    seedList(ctx, ['ich', 'Kind', 'Zwetschge'])
    const deck = await deckOf(ctx)
    const res = (await (await ctx.as(ALICE, `/api/decks/${deck}/suggest`, { method: 'POST', body: { count: 5 } })).json()) as SuggestResponse
    expect(res).toMatchObject({ added: 2, pending: 2, exhausted: true })
  })
})
