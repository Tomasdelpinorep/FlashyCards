import { Hono } from 'hono'
import { createGenerator } from './ai/create'
import type { SentenceGenerator } from './ai/generator'
import type { AppEnv, Bindings } from './env'
import { createAuthMiddleware, type AuthOptions } from './middleware/auth'
import { notFound, onError } from './middleware/errors'
import { cardRoutes } from './routes/cards'
import { deckRoutes } from './routes/decks'
import { languageRoutes } from './routes/languages'
import { meRoutes } from './routes/me'

export type AppOptions = AuthOptions & {
  /** Picks the sentence generator per request (tests inject a FakeGenerator). Default: from AI_PROVIDER. */
  generator?: (env: Bindings) => SentenceGenerator
}

/** Builds the API app. Options exist for tests (e.g. a local JWKS); production uses the defaults. */
export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>().basePath('/api')
  app.onError(onError)
  app.notFound(notFound)
  const pickGenerator = options.generator ?? createGenerator

  return (
    app
      // Public: liveness only, reveals nothing.
      .get('/health', (c) => c.json({ ok: true as const, time: new Date().toISOString() }))
      // Everything registered below requires authentication.
      .use('*', createAuthMiddleware(options))
      .use('*', async (c, next) => {
        c.set('generator', () => pickGenerator(c.env))
        await next()
      })
      .route('/', languageRoutes)
      .route('/', meRoutes)
      .route('/decks', deckRoutes)
      .route('/cards', cardRoutes)
  )
}
