import { Hono } from 'hono'
import type { AppEnv } from './env'
import { createAuthMiddleware, type AuthOptions } from './middleware/auth'
import { notFound, onError } from './middleware/errors'
import { deckRoutes } from './routes/decks'
import { languageRoutes } from './routes/languages'
import { meRoutes } from './routes/me'

export type AppOptions = AuthOptions

/** Builds the API app. Options exist for tests (e.g. a local JWKS); production uses the defaults. */
export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>().basePath('/api')
  app.onError(onError)
  app.notFound(notFound)

  return (
    app
      // Public: liveness only, reveals nothing.
      .get('/health', (c) => c.json({ ok: true as const, time: new Date().toISOString() }))
      // Everything registered below requires authentication.
      .use('*', createAuthMiddleware(options))
      .route('/', languageRoutes)
      .route('/', meRoutes)
      .route('/decks', deckRoutes)
  )
}
