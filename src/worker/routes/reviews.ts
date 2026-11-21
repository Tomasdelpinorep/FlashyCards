import { Hono } from 'hono'
import { ReviewSchema } from '../../shared/schemas'
import { submitReview } from '../db/reviews'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'

const MESSAGES = {
  not_found: 'Card not found',
  card_not_ready: 'This card is not ready for review',
  review_id_conflict: 'This review id belongs to another review',
  review_conflict: 'The card changed while saving the review; try again',
} as const

export const reviewRoutes = new Hono<AppEnv>().post('/', validate('json', ReviewSchema), async (c) => {
  const srs = await c.get('srs')()
  const result = await submitReview(c.env.DB, c.get('user').id, c.req.valid('json'), srs)
  if (!result.ok) return c.json({ error: result.error, message: MESSAGES[result.error] }, result.status)
  return c.json(result.response, 200)
})
