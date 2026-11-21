import { generateKeyPair } from 'jose'
import { describe, expect, it } from 'vitest'
import type { MeResponse } from '../../src/shared/schemas'
import { parseAllowedEmails } from '../../src/worker/middleware/auth'
import { setup, signToken } from '../helpers/app'

describe('auth middleware', () => {
  it('returns 401 when the token is missing', async () => {
    const { request } = setup()
    const res = await request('/api/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token with the wrong aud', async () => {
    const { request } = setup()
    const res = await request('/api/me', { token: await signToken('alice@example.com', { aud: 'other-app' }) })
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token with the wrong iss', async () => {
    const { request } = setup()
    const token = await signToken('alice@example.com', { iss: 'https://evil.cloudflareaccess.com' })
    const res = await request('/api/me', { token })
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed by an unknown key', async () => {
    const { request } = setup()
    const { privateKey } = await generateKeyPair('RS256')
    const res = await request('/api/me', { token: await signToken('alice@example.com', { key: privateKey }) })
    expect(res.status).toBe(401)
  })

  it('returns 401 for an expired token', async () => {
    const { request } = setup()
    const res = await request('/api/me', { token: await signToken('alice@example.com', { expiresIn: '-1m' }) })
    expect(res.status).toBe(401)
  })

  it('returns 200 for a valid token signed by the test key', async () => {
    const { request } = setup()
    const res = await request('/api/me', { token: await signToken('alice@example.com') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MeResponse
    expect(body.user.email).toBe('alice@example.com')
  })

  it('matches the allowlist case-insensitively and stores the email lowercased', async () => {
    const { request } = setup()
    const res = await request('/api/me', { token: await signToken('BOB@example.COM') })
    expect(res.status).toBe(200)
    expect(((await res.json()) as MeResponse).user.email).toBe('bob@example.com')
  })

  it('returns 403 when the email is not on the allowlist', async () => {
    const { request, sqlite } = setup()
    const res = await request('/api/me', { token: await signToken('mallory@example.com') })
    expect(res.status).toBe(403)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 })
  })

  it('returns 403 for everyone when ALLOWED_EMAILS is empty (fails closed)', async () => {
    const { request } = setup({ ALLOWED_EMAILS: '' })
    const res = await request('/api/me', { token: await signToken('alice@example.com') })
    expect(res.status).toBe(403)
  })

  it('returns 403 for everyone when ALLOWED_EMAILS is missing (a secret that was never set)', async () => {
    const { request, sqlite } = setup({ ALLOWED_EMAILS: undefined })
    const res = await request('/api/me', { token: await signToken('alice@example.com') })
    expect(res.status).toBe(403)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 })
  })

  it('returns 403 for a valid token without an email claim', async () => {
    const { request } = setup()
    const res = await request('/api/me', { token: await signToken(undefined) })
    expect(res.status).toBe(403)
  })

  it('ignores the dev bypass for a non-localhost host', async () => {
    const { request } = setup({ DEV_AUTH_EMAIL: 'dev@example.com' })
    const res = await request('/api/me', { host: 'flashcards.example.workers.dev' })
    expect(res.status).toBe(401)
  })

  it('honours the dev bypass on localhost and 127.0.0.1', async () => {
    const { request } = setup({ DEV_AUTH_EMAIL: 'dev@example.com' })
    for (const host of ['localhost:5173', '127.0.0.1:8787']) {
      const res = await request('/api/me', { host })
      expect(res.status).toBe(200)
      expect(((await res.json()) as MeResponse).user.email).toBe('dev@example.com')
    }
  })

  it('does not bypass on localhost when DEV_AUTH_EMAIL is unset', async () => {
    const { request } = setup()
    const res = await request('/api/me', { host: 'localhost:5173' })
    expect(res.status).toBe(401)
  })

  it('leaves /api/health public', async () => {
    const { request } = setup()
    expect((await request('/api/health')).status).toBe(200)
  })

  it('parses ALLOWED_EMAILS', () => {
    expect([...parseAllowedEmails(' A@example.com, ,b@Example.COM ')]).toEqual(['a@example.com', 'b@example.com'])
    expect(parseAllowedEmails(undefined).size).toBe(0)
  })
})
