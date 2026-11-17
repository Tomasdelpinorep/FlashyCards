import { describe, expect, it } from 'vitest'
import app from '../../src/worker/index'

describe('GET /api/health', () => {
  it('returns ok and an ISO timestamp', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; time: string }
    expect(body.ok).toBe(true)
    expect(Number.isNaN(Date.parse(body.time))).toBe(false)
  })

  it('returns 404 for unknown api routes', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
  })
})
