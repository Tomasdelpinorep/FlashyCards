import { Hono } from 'hono'
import { CardIdParamSchema } from '../../shared/schemas'
import { softDeleteCard } from '../db/cards'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'

// Cards in another user's deck are reported as 404, like decks.
export const cardRoutes = new Hono<AppEnv>().delete('/:id', validate('param', CardIdParamSchema), async (c) => {
  if (!(await softDeleteCard(c.env.DB, c.get('user').id, c.req.valid('param').id))) {
    return c.json({ error: 'not_found', message: 'Card not found' } as const, 404)
  }
  return c.json({ ok: true as const }, 200)
})
