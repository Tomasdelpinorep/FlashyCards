import { Hono } from 'hono'
import { LANGUAGE_CODES, LANGUAGES } from '../../shared/languages'
import type { AppEnv } from '../env'

export const languageRoutes = new Hono<AppEnv>().get('/languages', (c) =>
  c.json({ languages: LANGUAGE_CODES.map((code) => LANGUAGES[code]) }),
)
