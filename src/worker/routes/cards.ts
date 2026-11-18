import { Hono } from 'hono'
import { CardIdParamSchema } from '../../shared/schemas'
import { getCard, softDeleteCard } from '../db/cards'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'

// Cards in another user's deck are reported as 404, like decks.
const notFound = { error: 'not_found', message: 'Card not found' } as const

export const cardRoutes = new Hono<AppEnv>()
  .get('/:id', validate('param', CardIdParamSchema), async (c) => {
    const card = await getCard(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!card) return c.json(notFound, 404)
    return c.json({ card }, 200)
  })
  .delete('/:id', validate('param', CardIdParamSchema), async (c) => {
    if (!(await softDeleteCard(c.env.DB, c.get('user').id, c.req.valid('param').id))) return c.json(notFound, 404)
    return c.json({ ok: true as const }, 200)
  })
