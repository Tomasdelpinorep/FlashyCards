import { describe, expect, it } from 'vitest'
import type { CardDTO, CardListResponse, DeckStats, ImportResponse, MeResponse } from '../../src/shared/schemas'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

type Ctx = ReturnType<typeof setup>

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  const res = await ctx.as(email, '/api/me')
  return ((await res.json()) as MeResponse).decks[0]!.id
}

async function importText(
  ctx: Ctx,
  deckId: string,
  text: string,
  inputLang: 'target' | 'source' | 'auto' = 'target',
  email = ALICE,
): Promise<ImportResponse> {
  const res = await ctx.as(email, `/api/decks/${deckId}/import`, { method: 'POST', body: { text, inputLang } })
  expect(res.status).toBe(200)
  return (await res.json()) as ImportResponse
}

async function listCards(ctx: Ctx, deckId: string, query = '', email = ALICE): Promise<CardListResponse> {
  const res = await ctx.as(email, `/api/decks/${deckId}/cards${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as CardListResponse
}

function count(ctx: Ctx, where = '1 = 1'): number {
  return Number((ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${where}`).get() as { n: number }).n)
}

/** Seed a cached entry (as M4 would) plus aliases pointing at it. */
function seedEntry(
  ctx: Ctx,
  id: string,
  lemma: string,
  translation: string,
  aliases: [side: 'target' | 'source', key: string, sense?: string][],
  extra: { lemmaKey?: string; senseKey?: string; alts?: string[]; article?: string } = {},
) {
  ctx.sqlite
    .prepare(
      `INSERT INTO entries (id, source_lang, target_lang, lemma, lemma_key, sense_key, translation, alt_translations_json, grammar_json, created_at)
       VALUES (?, 'en', 'de', ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(id, lemma, extra.lemmaKey ?? lemma.toLowerCase(), extra.senseKey ?? '', translation, JSON.stringify(extra.alts ?? []), JSON.stringify({ article: extra.article ?? null }))
  for (const [side, key, sense = ''] of aliases) {
    ctx.sqlite
      .prepare(`INSERT INTO entry_aliases (source_lang, target_lang, input_side, alias_key, sense_key, entry_id) VALUES ('en', 'de', ?, ?, ?, ?)`)
      .run(side, key, sense, id)
  }
}

describe('POST /api/decks/:id/import', () => {
  it('der Hund / Hund / Katze;cat / comment / blank / gehen -> 3 cards, 1 in_file duplicate (line 2)', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const res = await importText(ctx, deck, 'der Hund\nHund\nKatze;cat\n# comment\n\ngehen')
    expect(res).toMatchObject({ added: 3, ready: 0, pending: 3, invalid: [] })
    expect(res.duplicates).toHaveLength(1)
    const { cards } = await listCards(ctx, deck)
    const hund = cards.find((c) => c.inputTerm === 'der Hund')!
    expect(res.duplicates[0]).toEqual({
      input: 'Hund',
      line: 2,
      reason: 'in_file',
      existing: { id: hund.id, display: 'der Hund', status: 'pending' },
      addedTranslation: null,
    })
    expect(cards.map((c) => c.inputTerm).sort()).toEqual(['Katze', 'der Hund', 'gehen'])
    expect(cards.every((c) => c.status === 'pending')).toBe(true)
    const katze = ctx.sqlite.prepare(`SELECT * FROM cards WHERE input_term = 'Katze'`).get() as Record<string, unknown>
    expect(katze).toMatchObject({ input_hint: 'cat', hint_key: 'cat', term_key: 'katze', input_lang: 'target', origin: 'import', state: 0 })
  })

  it('Bank;bench + Bank;bank -> 2 cards; re-importing Bank or Bank;Bench reports the bench card', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    expect((await importText(ctx, deck, 'Bank;bench\nBank;bank')).added).toBe(2)
    const bench = ctx.sqlite.prepare(`SELECT id FROM cards WHERE hint_key = 'bench'`).get() as { id: string }

    const plain = await importText(ctx, deck, 'Bank')
    expect(plain.added).toBe(0)
    expect(plain.duplicates).toEqual([
      { input: 'Bank', line: 1, reason: 'in_deck', existing: { id: bench.id, display: 'Bank', status: 'pending' }, addedTranslation: null },
    ])

    const cased = await importText(ctx, deck, 'Bank;Bench')
    expect(cased.added).toBe(0)
    expect(cased.duplicates).toMatchObject([{ input: 'Bank', hint: 'Bench', reason: 'in_deck', existing: { id: bench.id } }])
    expect(count(ctx)).toBe(2)
  })

  it('Gift (target) + gift (source) -> 2 cards', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    expect((await importText(ctx, deck, 'Gift', 'target')).added).toBe(1)
    const second = await importText(ctx, deck, 'gift', 'source')
    expect(second).toMatchObject({ added: 1, duplicates: [] })
    expect(count(ctx, "status = 'pending'")).toBe(2)
    // ...but the same side again is a duplicate.
    expect((await importText(ctx, deck, 'gift', 'source')).added).toBe(0)
  })

  it('re-importing a deleted word adds a fresh card', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund\nKatze')
    const hund = (await listCards(ctx, deck, '?q=hund')).cards[0]!
    expect((await ctx.as(ALICE, `/api/cards/${hund.id}`, { method: 'DELETE' })).status).toBe(200)

    const res = await importText(ctx, deck, 'Hund')
    expect(res).toMatchObject({ added: 1, duplicates: [] })
    const live = (await listCards(ctx, deck)).cards
    expect(live.map((c) => c.inputTerm).sort()).toEqual(['Hund', 'Katze'])
    expect(live.find((c) => c.inputTerm === 'Hund')!.id).not.toBe(hund.id)
    expect(count(ctx, "status = 'deleted'")).toBe(1)
  })

  it('two identical imports in parallel -> one set of cards; added counts sum to the unique rows', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const words = Array.from({ length: 20 }, (_, i) => `Wort${i}`)
    const text = [...words, 'Wort3', 'Bank;bench', 'Bank;bank'].join('\n') // 22 unique rows + 1 in-file dup
    const [a, b] = await Promise.all([importText(ctx, deck, text), importText(ctx, deck, text)])
    expect(a.added + b.added).toBe(22)
    expect(count(ctx)).toBe(22)
    // Every row is reported exactly once overall: the loser's rows as in_deck, plus 1 in_file each.
    expect(a.duplicates.length + b.duplicates.length).toBe(22 + 2)
    const ids = new Set((ctx.sqlite.prepare('SELECT id FROM cards').all() as { id: string }[]).map((r) => r.id))
    for (const d of [...a.duplicates, ...b.duplicates]) expect(ids.has(d.existing.id)).toBe(true)
    // The loser's reports point at the winner's card for the same row.
    const loser = a.added === 0 ? a : b
    const bench = loser.duplicates.find((d) => d.hint === 'bench')!
    expect(bench.reason).toBe('in_deck')
    expect(ctx.sqlite.prepare('SELECT hint_key FROM cards WHERE id = ?').get(bench.existing.id)).toMatchObject({ hint_key: 'bench' })
  })

  it('imports 500 rows (chunked inserts) and rejects 501', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const text = Array.from({ length: 500 }, (_, i) => `Wort${i};word ${i}`).join('\n')
    const res = await importText(ctx, deck, text)
    expect(res).toMatchObject({ added: 500, pending: 500, duplicates: [], invalid: [] })
    expect(count(ctx)).toBe(500)
    expect((await importText(ctx, deck, text)).duplicates).toHaveLength(500)
    expect(count(ctx)).toBe(500)

    const tooMany = await ctx.as(ALICE, `/api/decks/${deck}/import`, {
      method: 'POST',
      body: { text: `${text}\nnoch eins`, inputLang: 'target' },
    })
    expect(tooMany.status).toBe(400)
    expect(await tooMany.json()).toMatchObject({ error: 'too_many_rows' })
  })

  it('reports invalid rows and validates the body', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const res = await importText(ctx, deck, `Hund\n${'x'.repeat(101)}\n;dog`)
    expect(res.added).toBe(1)
    expect(res.invalid).toEqual([
      { line: 2, term: 'x'.repeat(100), reason: 'too_long' },
      { line: 3, term: 'dog', reason: 'empty_term' },
    ])
    for (const body of [{ text: 'Hund' }, { text: 'Hund', inputLang: 'klingon' }, { text: 1, inputLang: 'target' }]) {
      expect((await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body })).status).toBe(400)
    }
    expect(await importText(ctx, deck, '\n# nothing\n')).toEqual({ added: 0, ready: 0, pending: 0, invalid: [], duplicates: [] })
  })

  it('accepts CSV files by filename', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    const res = await ctx.as(ALICE, `/api/decks/${deck}/import`, {
      method: 'POST',
      body: { text: 'German,English\nHund,dog\n"Katze, -n",cat', filename: 'words.csv', inputLang: 'target' },
    })
    expect(((await res.json()) as ImportResponse).added).toBe(2)
    expect(ctx.sqlite.prepare(`SELECT term_key, hint_key FROM cards ORDER BY term_key`).all()).toEqual([
      { term_key: 'hund', hint_key: 'dog' },
      { term_key: 'katze', hint_key: 'cat' },
    ])
  })

  it("returns 404 for another user's deck", async () => {
    const ctx = setup()
    const deck = await deckOf(ctx, ALICE)
    await deckOf(ctx, BOB)
    const res = await ctx.as(BOB, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Hund', inputLang: 'target' } })
    expect(res.status).toBe(404)
    expect(count(ctx)).toBe(0)
  })
})

describe('import: alias cache (entry_aliases seeded as M4 would)', () => {
  it('inserts an alias hit as ready, with entry, lemma/sense keys, input_side and card_glosses', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-gehen', 'gehen', 'to go', [['target', 'ging']], { alts: ['to walk'] })
    const res = await importText(ctx, deck, 'ging\nlaufen')
    expect(res).toMatchObject({ added: 2, ready: 1, pending: 1 })
    const card = ctx.sqlite.prepare(`SELECT * FROM cards WHERE input_term = 'ging'`).get() as Record<string, unknown>
    expect(card).toMatchObject({ status: 'ready', entry_id: 'e-gehen', lemma_key: 'gehen', sense_key: '', input_side: 'target' })
    const glosses = ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ? ORDER BY gloss_key').all(card.id as string)
    expect(glosses).toEqual([{ gloss_key: 'go' }, { gloss_key: 'walk' }])
    const listed = (await listCards(ctx, deck, '?status=ready')).cards
    expect(listed).toMatchObject([{ display: 'gehen', translation: 'to go', status: 'ready' }])
  })

  it('alias ging -> gehen, with gehen already live in the deck: import-time duplicate, no row inserted', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-gehen', 'gehen', 'to go', [
      ['target', 'gehen'],
      ['target', 'ging'],
    ])
    expect((await importText(ctx, deck, 'gehen')).ready).toBe(1)
    const gehen = ctx.sqlite.prepare(`SELECT id FROM cards`).get() as { id: string }

    const res = await importText(ctx, deck, 'ging')
    expect(res).toMatchObject({ added: 0, ready: 0, pending: 0 })
    expect(res.duplicates).toEqual([
      { input: 'ging', line: 1, reason: 'in_deck', existing: { id: gehen.id, display: 'gehen', status: 'ready' }, addedTranslation: null },
    ])
    expect(count(ctx)).toBe(1)
  })

  it('also finds a pending card with the same lemma via the term key, and two aliases of one entry in one file', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-gehen', 'gehen', 'to go', [
      ['target', 'gehen'],
      ['target', 'ging'],
    ])
    const res = await importText(ctx, deck, 'gehen\nging')
    expect(res.added).toBe(1)
    expect(res.duplicates).toMatchObject([{ input: 'ging', line: 2, reason: 'in_file' }])
  })

  it('source-side alias hit merges a new translation into the existing card', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(
      ctx,
      'e-hund',
      'Hund',
      'dog',
      [
        ['target', 'hund'],
        ['source', 'dog'],
        ['source', 'hound'],
      ],
      { article: 'der' },
    )
    await importText(ctx, deck, 'der Hund')
    const hund = ctx.sqlite.prepare('SELECT id FROM cards').get() as { id: string }

    const dog = await importText(ctx, deck, 'dog', 'source')
    expect(dog.duplicates).toEqual([
      { input: 'dog', line: 1, reason: 'in_deck', existing: { id: hund.id, display: 'der Hund', status: 'ready' }, addedTranslation: null },
    ])
    const hound = await importText(ctx, deck, 'hound', 'source')
    expect(hound).toMatchObject({ added: 0, duplicates: [{ input: 'hound', addedTranslation: 'hound' }] })
    expect(ctx.sqlite.prepare('SELECT extra_translations_json AS x FROM cards WHERE id = ?').get(hund.id)).toEqual({ x: '["hound"]' })
    expect(ctx.sqlite.prepare("SELECT 1 AS ok FROM card_glosses WHERE card_id = ? AND gloss_key = 'hound'").get(hund.id)).toEqual({ ok: 1 })
    // Idempotent: the same translation is not added twice.
    expect((await importText(ctx, deck, 'hound', 'source')).duplicates[0]!.addedTranslation).toBeNull()
    expect(ctx.sqlite.prepare('SELECT extra_translations_json AS x FROM cards WHERE id = ?').get(hund.id)).toEqual({ x: '["hound"]' })
    expect(count(ctx)).toBe(1)
    expect((await listCards(ctx, deck)).cards[0]!.extraTranslations).toEqual(['hound'])
  })

  it('honours input_side: a target alias does not match source input, and auto checks both sides', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-gift', 'Gift', 'poison', [['target', 'gift']])
    const source = await importText(ctx, deck, 'gift', 'source')
    expect(source).toMatchObject({ added: 1, ready: 0, pending: 1 })
    const auto = await importText(ctx, deck, 'Gift', 'auto')
    expect(auto).toMatchObject({ added: 0, duplicates: [{ reason: 'in_deck' }] }) // term-key match with the source card (auto is compatible)

    const ctx2 = setup()
    const deck2 = await deckOf(ctx2)
    seedEntry(ctx2, 'e-gift', 'Gift', 'poison', [['target', 'gift']])
    const res = await importText(ctx2, deck2, 'Gift', 'auto')
    expect(res).toMatchObject({ added: 1, ready: 1 })
    expect(ctx2.sqlite.prepare('SELECT input_side, input_lang FROM cards').get()).toEqual({ input_side: 'target', input_lang: 'auto' })
  })

  it('ignores an ambiguous alias (more than one entry) and matches hints by sense_key', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-bank1', 'Bank', 'bank', [['target', 'bank', 'bank']], { senseKey: 'bank' })
    seedEntry(ctx, 'e-bank2', 'Bank', 'bench', [['target', 'bank', 'bench']], { senseKey: 'bench' })
    seedEntry(ctx, 'e-schloss1', 'Schloss', 'castle', [['source', 'lock']], { senseKey: '' })
    seedEntry(ctx, 'e-schloss2', 'Schloss', 'lock', [['target', 'lock']], { senseKey: 'lock' })

    // 'Bank' (no hint) after Bank;bench in the same file is an in_file duplicate (step 1).
    const res = await importText(ctx, deck, 'Bank;bench\nBank;bank\nBank', 'target')
    expect(res).toMatchObject({ added: 2, ready: 2, pending: 0, duplicates: [{ line: 3, reason: 'in_file' }] })
    expect(ctx.sqlite.prepare("SELECT entry_id FROM cards WHERE hint_key = 'bench'").get()).toEqual({ entry_id: 'e-bank2' })

    const ambiguous = await importText(ctx, deck, 'lock', 'auto')
    expect(ambiguous).toMatchObject({ added: 1, ready: 0, pending: 1 })
  })
})

describe('GET /api/decks/:id/cards and DELETE /api/cards/:id', () => {
  it('lists newest first, filters by status, searches and paginates', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, Array.from({ length: 7 }, (_, i) => `Wort${i}`).join('\n'))
    ctx.sqlite.exec(`UPDATE cards SET created_at = created_at - 1000 + CAST(substr(input_term, 5) AS INTEGER)`)
    await importText(ctx, deck, 'Mädchen;girl')

    const all = await listCards(ctx, deck)
    expect(all.cards).toHaveLength(8)
    expect(all.nextCursor).toBeNull()

    const seen: CardDTO[] = []
    let cursor: string | null = ''
    while (cursor !== null) {
      const page: CardListResponse = await listCards(ctx, deck, `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      expect(page.cards.length).toBeLessThanOrEqual(3)
      seen.push(...page.cards)
      cursor = page.nextCursor
    }
    expect(seen.map((c) => c.id)).toEqual(all.cards.map((c) => c.id))
    expect(seen.slice(1, 3).map((c) => c.inputTerm)).toEqual(['Wort6', 'Wort5'])

    expect((await listCards(ctx, deck, '?q=M%C3%84DCHEN')).cards.map((c) => c.inputTerm)).toEqual(['Mädchen'])
    expect((await listCards(ctx, deck, '?q=girl')).cards).toHaveLength(1)
    expect((await listCards(ctx, deck, '?q=das%20M%C3%A4dchen')).cards).toHaveLength(1)
    expect((await listCards(ctx, deck, '?q=wort')).cards).toHaveLength(7)
    expect((await listCards(ctx, deck, '?q=%25')).cards).toHaveLength(0)
    expect((await listCards(ctx, deck, '?status=ready')).cards).toHaveLength(0)
    expect((await listCards(ctx, deck, '?status=pending')).cards).toHaveLength(8)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/cards?status=bogus`)).status).toBe(400)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/cards?cursor=nope`)).status).toBe(400)
  })

  it('excludes duplicates by default and shows them with ?status=duplicate', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importText(ctx, deck, 'Hund')
    const hund = ctx.sqlite.prepare('SELECT id FROM cards').get() as { id: string }
    ctx.sqlite
      .prepare(
        `INSERT INTO cards (id, deck_id, input_term, term_key, input_lang, origin, status, duplicate_of, due, created_at, updated_at)
         VALUES ('dup', ?, 'dog', 'dog', 'source', 'import', 'duplicate', ?, 0, 0, 0)`,
      )
      .run(deck, hund.id)
    expect((await listCards(ctx, deck)).cards.map((c) => c.id)).toEqual([hund.id])
    expect((await listCards(ctx, deck, '?status=duplicate')).cards).toMatchObject([
      { id: 'dup', status: 'duplicate', duplicateOf: { id: hund.id, display: 'Hund' } },
    ])
  })

  it('soft-deletes owned cards only; others get 404', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await deckOf(ctx, BOB)
    await importText(ctx, deck, 'Hund')
    const { id } = ctx.sqlite.prepare('SELECT id FROM cards').get() as { id: string }

    expect((await ctx.as(BOB, `/api/cards/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await ctx.as(BOB, `/api/decks/${deck}/cards`)).status).toBe(404)
    expect((await ctx.as(BOB, `/api/decks/${deck}/stats`)).status).toBe(404)
    expect((await ctx.as(ALICE, '/api/cards/missing', { method: 'DELETE' })).status).toBe(404)
    expect(count(ctx, "status = 'pending'")).toBe(1)

    expect((await ctx.as(ALICE, `/api/cards/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await ctx.as(ALICE, `/api/cards/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(ctx.sqlite.prepare('SELECT status FROM cards WHERE id = ?').get(id)).toEqual({ status: 'deleted' })
    expect((await listCards(ctx, deck)).cards).toEqual([])
  })
})

describe('GET /api/decks/:id/stats', () => {
  it('counts by status and FSRS state, excluding duplicates and deleted cards', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    seedEntry(ctx, 'e-gehen', 'gehen', 'to go', [['target', 'gehen']])
    await importText(ctx, deck, 'gehen\nHund\nKatze\nMaus')
    ctx.sqlite.exec(`
      UPDATE cards SET status = 'failed' WHERE input_term = 'Katze';
      UPDATE cards SET status = 'deleted' WHERE input_term = 'Maus';
      INSERT INTO cards (id, deck_id, input_term, term_key, input_lang, origin, status, due, created_at, updated_at)
        VALUES ('dup', '${deck}', 'ging', 'ging', 'target', 'import', 'duplicate', 0, 0, 0);`)
    const res = await ctx.as(ALICE, `/api/decks/${deck}/stats`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { stats: DeckStats }).stats).toEqual({
      total: 3,
      ready: 1,
      pending: 1,
      failed: 1,
      suspended: 0,
      new: 1,
      learning: 0,
      review: 0,
      dueNow: 0,
      duplicates: 1,
    })
  })
})
