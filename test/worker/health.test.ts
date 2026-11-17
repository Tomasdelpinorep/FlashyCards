import { describe, expect, it } from 'vitest'
import app from '../../src/worker/index'
import { setup } from '../helpers/app'

describe('GET /api/health', () => {
  it('returns ok and an ISO timestamp without auth', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; time: string }
    expect(body.ok).toBe(true)
    expect(Number.isNaN(Date.parse(body.time))).toBe(false)
  })

  it('does not reveal unknown api routes to unauthenticated callers', async () => {
    const { request } = setup()
    expect((await request('/api/nope')).status).toBe(401)
  })

  it('returns a JSON 404 for unknown api routes when authenticated', async () => {
    const { as } = setup()
    const res = await as('alice@example.com', '/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
