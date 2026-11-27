import { Hono } from 'hono'
import { UpdateMeSchema, type MeResponse } from '../../shared/schemas'
import { listDecks, toDeckDTO } from '../db/decks'
import { toUserDTO, updateUser, userSettings } from '../db/users'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'
import { switchAppLanguage } from '../services/switchLanguage'

export const meRoutes = new Hono<AppEnv>()
  .get('/me', async (c) => {
    const user = c.get('user')
    const decks = await listDecks(c.env.DB, user.id)
    return c.json({ user: toUserDTO(user), decks: decks.map(toDeckDTO) } satisfies MeResponse)
  })
  .patch('/me', validate('json', UpdateMeSchema), async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const current = userSettings(user)
    let settings = body.settings ? { ...current, ...body.settings } : undefined
    // A new app language also converts the decks (services/switchLanguage.ts), saving the settings with them.
    if (settings && settings.uiLang !== current.uiLang) {
      await switchAppLanguage(c.env.DB, user.id, settings)
      settings = undefined
    }
    const updated = await updateUser(c.env.DB, user.id, { displayName: body.displayName, settings })
    const decks = await listDecks(c.env.DB, user.id)
    return c.json({ user: toUserDTO(updated), decks: decks.map(toDeckDTO) } satisfies MeResponse)
  })
