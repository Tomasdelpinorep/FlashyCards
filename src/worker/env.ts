import type { SentenceGenerator } from './ai/generator'
import type { Srs } from '../shared/srs'
import type { UserRow } from './db/users'

/**
 * Worker bindings. Declared explicitly (rather than using the generated global `Env`,
 * whose vars are typed as the literal defaults from wrangler.jsonc) so that values from
 * `.dev.vars` / secrets and optional ones like DEV_AUTH_EMAIL are typed correctly.
 */
export type Bindings = {
  DB: D1Database
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  /** Secret (`wrangler secret put`), never a wrangler.jsonc var. Missing or empty -> 403 for everyone. */
  ALLOWED_EMAILS?: string
  AI_PROVIDER: string
  AI_MODEL: string
  AI_USER_DAILY_LIMIT: string
  AI_GLOBAL_DAILY_LIMIT: string
  /** Local-only auth bypass; honoured only for localhost/127.0.0.1 hosts. Never set in production. */
  DEV_AUTH_EMAIL?: string
  ANTHROPIC_API_KEY?: string
}

export type Variables = {
  user: UserRow
  /** Lazily creates the sentence generator for this request (see createApp); null = AI not configured. */
  generator: () => SentenceGenerator | null
  /** The FSRS scheduler (memoised per config; tests may inject a config, e.g. fuzz off). */
  srs: () => Promise<Srs>
}

/** Hono env for every route. `user` is set by the auth middleware. */
export type AppEnv = { Bindings: Bindings; Variables: Variables }
