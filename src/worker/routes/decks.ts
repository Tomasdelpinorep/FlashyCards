import { Hono } from 'hono'
import { CreateDeckSchema, DEFAULT_DECK_SETTINGS, DeckIdParamSchema, UpdateDeckSchema } from '../../shared/schemas'
import { countDecks, createDeck, deckSettings, deleteDeck, getDeck, toDeckDTO, updateDeck } from '../db/decks'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'

// Decks owned by another user are reported as 404 (never 403) so their existence is not revealed.
const notFound = { error: 'not_found', message: 'Deck not found' } as const

export const deckRoutes = new Hono<AppEnv>()
  .post('/', validate('json', CreateDeckSchema), async (c) => {
    const body = c.req.valid('json')
    const row = await createDeck(c.env.DB, c.get('user').id, {
      name: body.name,
      sourceLang: body.sourceLang,
      targetLang: body.targetLang,
      settings: { ...DEFAULT_DECK_SETTINGS, ...body.settings },
    })
    return c.json({ deck: toDeckDTO(row) }, 201)
  })
  .patch('/:id', validate('param', DeckIdParamSchema), validate('json', UpdateDeckSchema), async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const existing = await getDeck(c.env.DB, userId, id)
    if (!existing) return c.json(notFound, 404)
    const row = await updateDeck(c.env.DB, userId, id, {
      name: body.name,
      settings: body.settings ? { ...deckSettings(existing), ...body.settings } : undefined,
    })
    if (!row) return c.json(notFound, 404)
    return c.json({ deck: toDeckDTO(row) }, 200)
  })
  .delete('/:id', validate('param', DeckIdParamSchema), async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    if (!(await getDeck(c.env.DB, userId, id))) return c.json(notFound, 404)
    // Every user keeps at least one deck (GET /me only auto-creates on first login).
    if ((await countDecks(c.env.DB, userId)) <= 1) {
      return c.json({ error: 'conflict', message: 'Cannot delete your only deck' }, 409)
    }
    if (!(await deleteDeck(c.env.DB, userId, id))) return c.json(notFound, 404)
    return c.json({ ok: true as const }, 200)
  })
