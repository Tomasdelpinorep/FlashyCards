/** PATCH /cards/:id (M8: edit + suspend) and an en -> es deck end to end. */
import { describe, expect, it } from 'vitest'
import { articleColor } from '../../src/shared/display'
import type { CardDTO, CardResponse, DeckDTO, DeckStats, LearnQueueResponse, MeResponse, ReviewInput, ReviewQueueResponse } from '../../src/shared/schemas'
import { CardState } from '../../src/shared/srs'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

type Ctx = ReturnType<typeof setup>

async function deckOf(ctx: Ctx, email = ALICE): Promise<string> {
  return ((await (await ctx.as(email, '/api/me')).json()) as MeResponse).decks[0]!.id
}

async function importAndGenerate(ctx: Ctx, deck: string, text: string, inputLang: 'target' | 'source' = 'target') {
  expect((await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text, inputLang } })).status).toBe(200)
  expect((await ctx.as(ALICE, `/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(200)
}

function idOf(ctx: Ctx, deck: string, term: string): string {
  return (ctx.sqlite.prepare('SELECT id FROM cards WHERE deck_id = ? AND input_term = ?').get(deck, term) as { id: string }).id
}

async function getCard(ctx: Ctx, id: string, email = ALICE): Promise<CardDTO> {
  const res = await ctx.as(email, `/api/cards/${id}`)
  expect(res.status).toBe(200)
  return ((await res.json()) as CardResponse).card
}

async function patch(ctx: Ctx, id: string, body: unknown, email = ALICE) {
  return ctx.as(email, `/api/cards/${id}`, { method: 'PATCH', body })
}

async function patchOk(ctx: Ctx, id: string, body: unknown): Promise<CardDTO> {
  const res = await patch(ctx, id, body)
  expect(res.status, await res.clone().text()).toBe(200)
  return ((await res.json()) as CardResponse).card
}

function glosses(ctx: Ctx, id: string): string[] {
  return (ctx.sqlite.prepare('SELECT gloss_key FROM card_glosses WHERE card_id = ? ORDER BY gloss_key').all(id) as { gloss_key: string }[]).map(
    (r) => r.gloss_key,
  )
}

async function stats(ctx: Ctx, deck: string): Promise<DeckStats> {
  return ((await (await ctx.as(ALICE, `/api/decks/${deck}/stats`)).json()) as { stats: DeckStats }).stats
}

function review(cardId: string, rating: 1 | 2 | 3 | 4 = 1): ReviewInput {
  return { id: crypto.randomUUID(), cardId, rating, direction: 'target-source', reviewedAt: Date.now() }
}

describe('PATCH /api/cards/:id', () => {
  it('edits translation, sentences, note and extras; empty restores the generated value; lemma untouched', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importAndGenerate(ctx, deck, 'Hund')
    const id = idOf(ctx, deck, 'Hund')
    const lemmaKey = ctx.sqlite.prepare('SELECT lemma_key FROM cards WHERE id = ?').get(id)

    const c = await patchOk(ctx, id, {
      translation: ' doggy ',
      exampleTarget: 'Mein Hund schläft.',
      note: 'Like "hound"',
      extraTranslations: ['pup', ' Pup ', 'pooch', ''],
    })
    expect(c).toMatchObject({ display: 'der Hund', translation: 'doggy', note: 'Like "hound"', extraTranslations: ['pup', 'pooch'] })
    expect(c.content).toMatchObject({ lemma: 'Hund', exampleTarget: 'Mein Hund schläft.', exampleSource: 'The [[dog]] is playing in the garden.' })
    expect(glosses(ctx, id)).toEqual(['doggy', 'hound', 'pooch', 'pup'])

    const back = await patchOk(ctx, id, { translation: '', exampleTarget: null, note: null })
    expect(back).toMatchObject({ translation: 'dog', note: null })
    expect(back.content?.exampleTarget).toBe('Der [[Hund]] spielt im Garten.')
    expect(glosses(ctx, id)).toEqual(['dog', 'hound', 'pooch', 'pup'])
    expect(ctx.sqlite.prepare('SELECT lemma_key FROM cards WHERE id = ?').get(id)).toEqual(lemmaKey)
    expect(ctx.sqlite.prepare('SELECT override_json FROM cards WHERE id = ?').get(id)).toEqual({ override_json: null })
  })

  it('rewrites the glosses so "Also in your deck" follows the edit', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importAndGenerate(ctx, deck, 'Hund\nKatze')
    await importAndGenerate(ctx, deck, 'water', 'source') // source-side input: its own term stays a gloss
    const hund = idOf(ctx, deck, 'Hund')
    const katze = idOf(ctx, deck, 'Katze')
    const wasser = idOf(ctx, deck, 'water')
    expect((await getCard(ctx, katze)).alsoInDeck).toEqual([])

    await patchOk(ctx, katze, { translation: 'hound' })
    expect((await getCard(ctx, katze)).alsoInDeck).toEqual([{ id: hund, display: 'der Hund' }])
    expect((await getCard(ctx, hund)).alsoInDeck).toEqual([{ id: katze, display: 'die Katze' }])

    await patchOk(ctx, katze, { translation: null })
    expect((await getCard(ctx, hund)).alsoInDeck).toEqual([])

    await patchOk(ctx, hund, { extraTranslations: ['cat'] })
    expect((await getCard(ctx, katze)).alsoInDeck).toEqual([{ id: hund, display: 'der Hund' }])
    await patchOk(ctx, hund, { extraTranslations: [] })
    expect((await getCard(ctx, katze)).alsoInDeck).toEqual([])

    await patchOk(ctx, wasser, { translation: 'H2O' })
    expect(glosses(ctx, wasser)).toEqual(['h2o', 'water'])
    // A note-only edit leaves the glosses alone.
    await patchOk(ctx, wasser, { note: 'n' })
    expect(glosses(ctx, wasser)).toEqual(['h2o', 'water'])
  })

  it('suspended cards leave /learn, /review and the ready stats; unsuspend keeps the FSRS state', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    await importAndGenerate(ctx, deck, 'Hund\nKatze')
    const hund = idOf(ctx, deck, 'Hund')
    const katze = idOf(ctx, deck, 'Katze')
    expect((await ctx.as(ALICE, '/api/reviews', { method: 'POST', body: review(hund) })).status).toBe(200)
    const reviewed = await getCard(ctx, hund)
    expect(reviewed.state).not.toBe(CardState.New)
    const reviewQ = async () => ((await (await ctx.as(ALICE, `/api/decks/${deck}/review`)).json()) as ReviewQueueResponse).cards.map((c) => c.id)
    const learnQ = async () => ((await (await ctx.as(ALICE, `/api/decks/${deck}/learn`)).json()) as LearnQueueResponse).cards.map((c) => c.id)
    expect(await reviewQ()).toEqual([hund])
    expect(await learnQ()).toEqual([katze])

    expect((await patchOk(ctx, hund, { status: 'suspended' })).status).toBe('suspended')
    await patchOk(ctx, katze, { status: 'suspended' })
    expect(await reviewQ()).toEqual([])
    expect(await learnQ()).toEqual([])
    expect(await stats(ctx, deck)).toMatchObject({ total: 2, ready: 0, suspended: 2, new: 0, learning: 0, dueNow: 0 })
    // Reviews of a suspended card are refused (the outbox drops 409s).
    expect((await ctx.as(ALICE, '/api/reviews', { method: 'POST', body: review(hund) })).status).toBe(409)
    // Suspended cards can still be edited; the Words filter lists them.
    await patchOk(ctx, hund, { note: 'later' })
    const list = (await (await ctx.as(ALICE, `/api/decks/${deck}/cards?status=suspended`)).json()) as { cards: CardDTO[] }
    expect(list.cards.map((c) => c.id).sort()).toEqual([hund, katze].sort())

    const back = await patchOk(ctx, hund, { status: 'ready' })
    expect(back.srs).toEqual(reviewed.srs)
    expect(await reviewQ()).toEqual([hund])
    expect(await stats(ctx, deck)).toMatchObject({ ready: 1, suspended: 1 })
  })

  it('409 unless ready or suspended; 404 for another user; 400 for an empty or unknown body', async () => {
    const ctx = setup()
    const deck = await deckOf(ctx)
    expect((await ctx.as(ALICE, `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Hund', inputLang: 'target' } })).status).toBe(200)
    const hund = idOf(ctx, deck, 'Hund')
    const pending = await patch(ctx, hund, { status: 'suspended' })
    expect(pending.status).toBe(409)
    expect(await pending.json()).toMatchObject({ error: 'card_not_ready' })
    expect(ctx.sqlite.prepare('SELECT status FROM cards WHERE id = ?').get(hund)).toEqual({ status: 'pending' })

    await ctx.as(ALICE, `/api/decks/${deck}/generate`, { method: 'POST' })
    await deckOf(ctx, BOB)
    expect((await patch(ctx, hund, { note: 'mine now' }, BOB)).status).toBe(404)
    expect((await patch(ctx, 'nope', { note: 'x' })).status).toBe(404)
    expect((await patch(ctx, hund, {})).status).toBe(400)
    expect((await patch(ctx, hund, { lemma: 'Katze' })).status).toBe(400)
    expect((await patch(ctx, hund, { status: 'deleted' })).status).toBe(400)
    expect((await patch(ctx, hund, { note: 'x'.repeat(501) })).status).toBe(400)
    expect((await patch(ctx, hund, { extraTranslations: Array.from({ length: 11 }, (_, i) => `w${i}`) })).status).toBe(400)
    expect(ctx.sqlite.prepare('SELECT note FROM cards WHERE id = ?').get(hund)).toEqual({ note: null })
  })
})

describe('an en -> es deck', () => {
  it('imports, generates (fake), learns and reviews without German leaking in', async () => {
    const ctx = setup()
    await deckOf(ctx)
    const res = await ctx.as(ALICE, '/api/decks', { method: 'POST', body: { name: 'Spanish', sourceLang: 'en', targetLang: 'es' } })
    expect(res.status).toBe(201)
    const deck = ((await res.json()) as { deck: DeckDTO }).deck.id
    await importAndGenerate(ctx, deck, 'perro')
    await importAndGenerate(ctx, deck, 'cat\nwindow', 'source')

    const list = ((await (await ctx.as(ALICE, `/api/decks/${deck}/cards`)).json()) as { cards: CardDTO[] }).cards
    const byInput = Object.fromEntries(list.map((c) => [c.inputTerm, c]))
    expect(byInput.perro).toMatchObject({ status: 'ready', display: 'el perro', translation: 'dog' })
    expect(byInput.perro!.content?.grammar).toMatchObject({ gender: 'masculine', article: 'el', plural: 'los perros' })
    expect(byInput.cat).toMatchObject({ status: 'ready', display: 'el gato', translation: 'cat' })
    expect(byInput.window).toMatchObject({ status: 'ready', display: 'window (es)' })
    expect(byInput.window!.content?.exampleTarget).toBe('La palabra [[window (es)]] es nueva.')
    expect(JSON.stringify(list)).not.toMatch(/\b(der|die|das|Das Wort)\b/)

    // Article colouring comes from the es config (el/la), never from German articles.
    expect(articleColor('es', 'el perro')).toMatchObject({ article: 'el', color: 'blue' })
    expect(articleColor('es', 'der Hund')).toBeNull()

    const learn = (await (await ctx.as(ALICE, `/api/decks/${deck}/learn`)).json()) as LearnQueueResponse
    expect(learn.cards.map((c) => c.inputTerm)).toEqual(['perro', 'cat', 'window'])
    for (const c of learn.cards) expect((await ctx.as(ALICE, '/api/reviews', { method: 'POST', body: review(c.id) })).status).toBe(200)
    const due = (await (await ctx.as(ALICE, `/api/decks/${deck}/review`)).json()) as ReviewQueueResponse
    expect(due.cards).toHaveLength(3)
    expect(await stats(ctx, deck)).toMatchObject({ total: 3, ready: 3, reviewedToday: 3, newToday: 3 })
  })
})
