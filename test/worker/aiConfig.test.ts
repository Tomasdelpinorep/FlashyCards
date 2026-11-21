/** M5 Part 0: /generate fails closed when AI is not configured (no silent fake fallback in production). */
import { describe, expect, it, vi } from 'vitest'
import type { GenerateResponse, MeResponse } from '../../src/shared/schemas'
import { setup } from '../helpers/app'

const ALICE = 'alice@example.com'

async function deckWithPending(ctx: ReturnType<typeof setup>, host?: string) {
  const opts = host ? { host } : {}
  const req = (path: string, o: { method?: string; body?: unknown } = {}) =>
    host ? ctx.request(path, { ...o, ...opts }) : ctx.as(ALICE, path, o)
  const me = (await (await req('/api/me')).json()) as MeResponse
  const deck = me.decks[0]!.id
  const imp = await req(`/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Hund\nKatze', inputLang: 'target' } })
  expect(imp.status).toBe(200)
  return { deck, req }
}

const scalar = (ctx: ReturnType<typeof setup>, sql: string) => Object.values(ctx.sqlite.prepare(sql).get() as object)[0]

describe('POST /generate when AI is not configured', () => {
  it('AI_PROVIDER=anthropic without a key: 503 ai_not_configured, cards stay pending, nothing written', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = setup({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined }, { generator: 'env' })
    const { deck, req } = await deckWithPending(ctx)
    const res = await req(`/api/decks/${deck}/generate`, { method: 'POST' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_not_configured', message: "AI isn't configured on the server" })
    expect(ctx.sqlite.prepare('SELECT status, gen_attempts, gen_claimed_at FROM cards').all()).toEqual([
      { status: 'pending', gen_attempts: 0, gen_claimed_at: null },
      { status: 'pending', gen_attempts: 0, gen_claimed_at: null },
    ])
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(0)
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entry_aliases')).toBe(0)
    expect(scalar(ctx, 'SELECT COUNT(*) FROM ai_usage')).toBe(0)
    err.mockRestore()
  })

  it('AI_PROVIDER unset without a key on a production host: 503', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = setup({ AI_PROVIDER: '' }, { generator: 'env' })
    const { deck, req } = await deckWithPending(ctx)
    expect((await req(`/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(503)
    expect(scalar(ctx, 'SELECT COUNT(*) FROM entries')).toBe(0)
    err.mockRestore()
  })

  it('AI_PROVIDER unset without a key on localhost (dev bypass): the fake generator is used', async () => {
    const ctx = setup({ AI_PROVIDER: '', DEV_AUTH_EMAIL: 'dev@example.com' }, { generator: 'env' })
    const { deck, req } = await deckWithPending(ctx, 'localhost:5173')
    const res = await req(`/api/decks/${deck}/generate`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()) as GenerateResponse).toMatchObject({ processed: 2, generated: 2, remaining: 0 })
    expect(scalar(ctx, "SELECT COUNT(*) FROM entries WHERE model = 'fake'")).toBe(2)
  })

  it('AI_PROVIDER=fake works on any host', async () => {
    const ctx = setup({ AI_PROVIDER: 'fake' }, { generator: 'env' })
    const { deck, req } = await deckWithPending(ctx)
    expect((await req(`/api/decks/${deck}/generate`, { method: 'POST' })).status).toBe(200)
  })
})
