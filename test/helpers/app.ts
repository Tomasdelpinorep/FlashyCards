/** Test harness: app with a local JWKS, an in-memory D1, and token/request helpers. */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { SentenceGenerator } from '../../src/worker/ai/generator'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { createApp } from '../../src/worker/app'
import type { Bindings } from '../../src/worker/env'
import { createTestD1 } from './d1'
import type { SrsConfig } from '../../src/shared/srs'

export const TEAM_DOMAIN = 'https://test-team.cloudflareaccess.com'
export const AUD = 'test-aud-tag'
export const ALLOWED = ['alice@example.com', 'Bob@Example.com']

const KID = 'test-key-1'
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
const localJwks = createLocalJWKSet({ keys: [publicJwk] })

export async function signToken(
  email: string | undefined,
  overrides: { aud?: string; iss?: string; expiresIn?: string; key?: CryptoKey } = {},
): Promise<string> {
  const jwt = new SignJWT(email === undefined ? {} : { email })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.iss ?? TEAM_DOMAIN)
    .setAudience(overrides.aud ?? AUD)
    .setSubject('user-sub')
    .setExpirationTime(overrides.expiresIn ?? '1h')
  return jwt.sign(overrides.key ?? privateKey)
}

type RequestOpts = { method?: string; token?: string; body?: unknown; host?: string }

/**
 * `options.generator`: the generator every request uses (default: a fresh FakeGenerator), or
 * `'env'` to use the production factory (ai/create.ts), which reads AI_PROVIDER and the host.
 */
export function setup(
  envOverrides: Partial<Bindings> = {},
  options: { generator?: SentenceGenerator | 'env'; srs?: Partial<SrsConfig> } = {},
) {
  const { db, sqlite, counter } = createTestD1()
  /** The generator every request uses (a FakeGenerator unless the test passes its own). */
  const useEnv = options.generator === 'env'
  const generator = options.generator === 'env' || options.generator === undefined ? new FakeGenerator() : options.generator
  const env: Bindings = {
    DB: db,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ALLOWED_EMAILS: ALLOWED.join(', '),
    AI_PROVIDER: 'fake',
    AI_MODEL: 'claude-haiku-5-5',
    AI_USER_DAILY_LIMIT: '200',
    AI_GLOBAL_DAILY_LIMIT: '2000',
    ...envOverrides,
  }
  const app = createApp(
    useEnv ? { jwks: () => localJwks, srs: options.srs } : { jwks: () => localJwks, generator: () => generator, srs: options.srs },
  )

  /** Request against a non-local host (as in production) unless `host` says otherwise. */
  async function request(path: string, opts: RequestOpts = {}) {
    const headers: Record<string, string> = {}
    if (opts.token) headers['Cf-Access-Jwt-Assertion'] = opts.token
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    const url = `https://${opts.host ?? 'flashcards.example.workers.dev'}${path}`
    const init = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }
    return app.request(url, init, env)
  }

  /** Request as `email` with a valid token. */
  async function as(email: string, path: string, opts: { method?: string; body?: unknown } = {}) {
    return request(path, { ...opts, token: await signToken(email) })
  }

  /** Number of D1 statements executed while `fn` runs (run it alone: the counter is per database). */
  async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number; log: string[] }> {
    const start = counter.count
    const result = await fn()
    return { result, queries: counter.count - start, log: counter.log.slice(start) }
  }

  return { app, env, sqlite, request, as, generator, countQueries }
}
