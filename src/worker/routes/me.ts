import { Hono } from 'hono'
import { UpdateMeSchema, type MeResponse } from '../../shared/schemas'
import { listDecks, toDeckDTO } from '../db/decks'
import { toUserDTO, updateUser, userSettings } from '../db/users'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'

export const meRoutes = new Hono<AppEnv>()
  .get('/me', async (c) => {
    const user = c.get('user')
    const decks = await listDecks(c.env.DB, user.id)
    return c.json({ user: toUserDTO(user), decks: decks.map(toDeckDTO) } satisfies MeResponse)
  })
  .patch('/me', validate('json', UpdateMeSchema), async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const updated = await updateUser(c.env.DB, user.id, {
      displayName: body.displayName,
      settings: body.settings ? { ...userSettings(user), ...body.settings } : undefined,
    })
    return c.json({ user: toUserDTO(updated) })
  })
