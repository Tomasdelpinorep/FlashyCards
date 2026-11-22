import { Hono } from 'hono'
import { CardIdParamSchema, UpdateCardSchema } from '../../shared/schemas'
import { getCard, softDeleteCard } from '../db/cards'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'
import { updateCard } from '../services/editCard'

// Cards in another user's deck are reported as 404, like decks.
const notFound = { error: 'not_found', message: 'Card not found' } as const

export const cardRoutes = new Hono<AppEnv>()
  .get('/:id', validate('param', CardIdParamSchema), async (c) => {
    const card = await getCard(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!card) return c.json(notFound, 404)
    return c.json({ card }, 200)
  })
  .patch('/:id', validate('param', CardIdParamSchema), validate('json', UpdateCardSchema), async (c) => {
    const r = await updateCard(c.env.DB, c.get('user').id, c.req.valid('param').id, c.req.valid('json'))
    if ('card' in r) return c.json({ card: r.card }, 200)
    if (r.error === 'not_found') return c.json(notFound, 404)
    return c.json({ error: 'card_not_ready' as const, message: `A ${r.status} card can't be edited` }, 409)
  })
  .delete('/:id', validate('param', CardIdParamSchema), async (c) => {
    if (!(await softDeleteCard(c.env.DB, c.get('user').id, c.req.valid('param').id))) return c.json(notFound, 404)
    return c.json({ ok: true as const }, 200)
  })
