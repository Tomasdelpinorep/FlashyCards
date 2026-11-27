import { describe, expect, it } from 'vitest'
import type { DeckDTO, MeResponse, UserDTO } from '../../src/shared/schemas'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

type As = ReturnType<typeof setup>['as']

async function me(as: As, email: string): Promise<MeResponse> {
  const res = await as(email, '/api/me')
  expect(res.status).toBe(200)
  return (await res.json()) as MeResponse
}

describe('GET /api/me', () => {
  it('creates the default German deck once, on first call', async () => {
    const { as } = setup()
    const first = await me(as, ALICE)
    expect(first.decks).toHaveLength(1)
    expect(first.decks[0]).toMatchObject({
      name: 'German',
      sourceLang: 'en',
      targetLang: 'de',
      settings: { dailyNewLimit: 10, sentenceLevel: 'A1-A2', skipTopN: 0 },
    })
    const second = await me(as, ALICE)
    expect(second.decks.map((d) => d.id)).toEqual(first.decks.map((d) => d.id))
  })

  it('does not create duplicate users or default decks for concurrent first calls', async () => {
    const { as, sqlite } = setup()
    await Promise.all([me(as, ALICE), me(as, ALICE), me(as, ALICE)])
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM decks').get()).toMatchObject({ n: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 1 })
  })

  it('gives two different emails separate users and decks', async () => {
    const { as } = setup()
    const a = await me(as, ALICE)
    const b = await me(as, BOB)
    expect(a.user.id).not.toBe(b.user.id)
    expect(a.decks).toHaveLength(1)
    expect(b.decks).toHaveLength(1)
    expect(a.decks[0]!.id).not.toBe(b.decks[0]!.id)

    await as(ALICE, '/api/decks', { method: 'POST', body: { name: 'Spanish', sourceLang: 'en', targetLang: 'es' } })
    expect((await me(as, ALICE)).decks).toHaveLength(2)
    expect((await me(as, BOB)).decks).toHaveLength(1)
  })

  it('returns default user settings', async () => {
    const { as } = setup()
    expect((await me(as, ALICE)).user.settings).toEqual({
      theme: 'system',
      ttsAutoplay: false,
      studyDirection: 'target-source',
      hideSentenceOnFront: false,
      uiLang: 'en',
    })
  })
})

describe('PATCH /api/me', () => {
  it('merges settings and sets the display name', async () => {
    const { as } = setup()
    const res = await as(ALICE, '/api/me', {
      method: 'PATCH',
      body: { displayName: 'Alice', settings: { studyDirection: 'mixed', theme: 'dark' } },
    })
    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: UserDTO }
    expect(user.displayName).toBe('Alice')
    expect(user.settings).toMatchObject({ studyDirection: 'mixed', theme: 'dark', ttsAutoplay: false })

    const res2 = await as(ALICE, '/api/me', { method: 'PATCH', body: { settings: { ttsAutoplay: true } } })
    const { user: user2 } = (await res2.json()) as { user: UserDTO }
    expect(user2.displayName).toBe('Alice')
    expect(user2.settings).toMatchObject({ studyDirection: 'mixed', theme: 'dark', ttsAutoplay: true })
  })

  it('rejects invalid bodies with 400', async () => {
    const { as } = setup()
    const bad = [{ settings: { studyDirection: 'sideways' } }, { settings: { unknown: 1 } }, { foo: 1 }]
    for (const body of bad) {
      const res = await as(ALICE, '/api/me', { method: 'PATCH', body })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'invalid_request' })
    }
  })
})

describe('deck CRUD', () => {
  it('creates, renames, updates settings and deletes a deck', async () => {
    const { as } = setup()
    await me(as, ALICE)

    const created = await as(ALICE, '/api/decks', {
      method: 'POST',
      body: { name: '  Spanish ', sourceLang: 'en', targetLang: 'es', settings: { dailyNewLimit: 5 } },
    })
    expect(created.status).toBe(201)
    const { deck } = (await created.json()) as { deck: DeckDTO }
    expect(deck).toMatchObject({
      name: 'Spanish',
      sourceLang: 'en',
      targetLang: 'es',
      settings: { dailyNewLimit: 5, sentenceLevel: 'A1-A2', skipTopN: 0 },
    })

    const renamed = await as(ALICE, `/api/decks/${deck.id}`, { method: 'PATCH', body: { name: 'Espanol' } })
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as { deck: DeckDTO }).deck.name).toBe('Espanol')

    const tuned = await as(ALICE, `/api/decks/${deck.id}`, { method: 'PATCH', body: { settings: { skipTopN: 100 } } })
    expect(tuned.status).toBe(200)
    expect(((await tuned.json()) as { deck: DeckDTO }).deck).toMatchObject({
      name: 'Espanol',
      settings: { dailyNewLimit: 5, sentenceLevel: 'A1-A2', skipTopN: 100 },
    })

    const deleted = await as(ALICE, `/api/decks/${deck.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect((await me(as, ALICE)).decks.map((d) => d.name)).toEqual(['German'])

    expect((await as(ALICE, `/api/decks/${deck.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('deletes the last deck; /me then returns 0 decks and does not recreate the default', async () => {
    const { as, sqlite } = setup()
    const { decks } = await me(as, ALICE)
    expect(decks).toHaveLength(1)
    const res = await as(ALICE, `/api/decks/${decks[0]!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await me(as, ALICE)).decks).toEqual([])
    expect((await me(as, ALICE)).decks).toEqual([])
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM decks').get()).toMatchObject({ n: 0 })

    // A user with zero decks can create one again.
    const created = await as(ALICE, '/api/decks', { method: 'POST', body: { name: 'Neu', sourceLang: 'en', targetLang: 'de' } })
    expect(created.status).toBe(201)
    expect((await me(as, ALICE)).decks.map((d) => d.name)).toEqual(['Neu'])
  })

  it('creates the default deck when the user row is created, whatever the first request is', async () => {
    const { as, sqlite } = setup()
    expect((await as(ALICE, '/api/languages')).status).toBe(200)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM decks').get()).toMatchObject({ n: 1 })
    expect((await me(as, ALICE)).decks).toHaveLength(1)
  })

  it('validates create and update bodies', async () => {
    const { as } = setup()
    const { decks } = await me(as, ALICE)
    const bad = [
      { name: '', sourceLang: 'en', targetLang: 'de' },
      { name: 'X', sourceLang: 'en', targetLang: 'en' },
      { name: 'X', sourceLang: 'en', targetLang: 'xx' },
      { name: 'X', sourceLang: 'en', targetLang: 'de', settings: { dailyNewLimit: -1 } },
    ]
    for (const body of bad) {
      expect((await as(ALICE, '/api/decks', { method: 'POST', body })).status).toBe(400)
    }
    const id = decks[0]!.id
    expect((await as(ALICE, `/api/decks/${id}`, { method: 'PATCH', body: {} })).status).toBe(400)
    expect((await as(ALICE, `/api/decks/${id}`, { method: 'PATCH', body: { targetLang: 'es' } })).status).toBe(400)
  })

  it("returns 404 when user B touches user A's deck, and leaves it unchanged", async () => {
    const { as } = setup()
    const aliceDeck = (await me(as, ALICE)).decks[0]!
    await me(as, BOB)

    const patch = await as(BOB, `/api/decks/${aliceDeck.id}`, { method: 'PATCH', body: { name: 'pwned' } })
    expect(patch.status).toBe(404)
    const del = await as(BOB, `/api/decks/${aliceDeck.id}`, { method: 'DELETE' })
    expect(del.status).toBe(404)
    expect((await as(BOB, '/api/decks/does-not-exist', { method: 'DELETE' })).status).toBe(404)

    expect((await me(as, ALICE)).decks).toEqual([aliceDeck])
  })
})

describe('GET /api/languages', () => {
  it('lists en, de and es', async () => {
    const { as } = setup()
    const res = await as(ALICE, '/api/languages')
    expect(res.status).toBe(200)
    const { languages } = (await res.json()) as { languages: { code: string }[] }
    expect(languages.map((l) => l.code)).toEqual(['en', 'de', 'es'])
  })
})
