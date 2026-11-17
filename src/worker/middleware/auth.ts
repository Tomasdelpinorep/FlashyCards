import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { upsertUser } from '../db/users'
import type { AppEnv, Bindings } from '../env'

/** Resolves the key set used to verify Access JWTs. Injectable so tests can use a local key pair. */
export type JwksResolver = (env: Bindings) => JWTVerifyGetKey

export type AuthOptions = { jwks?: JwksResolver }

// Module-scope cache: one remote JWKS per team domain, reused across requests in an isolate.
// jose's remote set handles key rotation (refetch on unknown kid) and its own cooldown.
const remoteJwks = new Map<string, JWTVerifyGetKey>()

export const remoteJwksResolver: JwksResolver = (env) => {
  const url = `${teamDomain(env)}/cdn-cgi/access/certs`
  let jwks = remoteJwks.get(url)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url))
    remoteJwks.set(url, jwks)
  }
  return jwks
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

function teamDomain(env: Bindings): string {
  return (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '')
}

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Authenticates every request it guards:
 * 1. Dev bypass: DEV_AUTH_EMAIL is set AND the request host is localhost/127.0.0.1.
 * 2. Otherwise verify `Cf-Access-Jwt-Assertion` (signature via team JWKS, `aud`, `iss`),
 *    then require the email to be in ALLOWED_EMAILS (fails closed when empty).
 * Then upserts the user and stores it on the context as `user`.
 */
export function createAuthMiddleware(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const resolveJwks = options.jwks ?? remoteJwksResolver

  return async (c, next) => {
    const env = c.env
    let email: string | undefined

    const devEmail = env.DEV_AUTH_EMAIL?.trim()
    if (devEmail && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      email = devEmail
    } else {
      const token = c.req.header('Cf-Access-Jwt-Assertion')
      if (!token) return c.json({ error: 'unauthorized', message: 'Missing access token' }, 401)

      const issuer = teamDomain(env)
      const audience = (env.ACCESS_AUD ?? '').trim()
      if (!issuer || !audience) {
        console.error('auth: ACCESS_TEAM_DOMAIN / ACCESS_AUD are not configured')
        return c.json({ error: 'server_misconfigured', message: 'Access is not configured' }, 500)
      }

      try {
        const { payload } = await jwtVerify(token, resolveJwks(env), {
          issuer,
          audience,
          algorithms: ['RS256'],
        })
        if (typeof payload.email !== 'string' || !payload.email) {
          return c.json({ error: 'forbidden', message: 'Token has no email' }, 403)
        }
        email = payload.email
      } catch {
        return c.json({ error: 'unauthorized', message: 'Invalid access token' }, 401)
      }

      if (!parseAllowedEmails(env.ALLOWED_EMAILS).has(email.trim().toLowerCase())) {
        return c.json({ error: 'forbidden', message: 'Email not allowed' }, 403)
      }
    }

    c.set('user', await upsertUser(env.DB, email))
    await next()
  }
}
