/**
 * Runs once, after Playwright has started the e2e server (which wiped and re-migrated the D1
 * state). The very first authenticated request below is the e2e user's first login ever, so this
 * is the only place the real "first run" (user + default deck created together) can be checked;
 * after it, the per-test reset (fixtures.ts) recreates an equivalent deck through the API.
 */
import { request, type FullConfig } from '@playwright/test'
import type { MeResponse } from '../src/shared/schemas'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const ctx = await request.newContext({ baseURL })
  try {
    const res = await ctx.get('/api/me')
    if (!res.ok()) throw new Error(`GET /api/me -> ${res.status()}`)
    const me = (await res.json()) as MeResponse
    const decks = me.decks.map((d) => `${d.name} ${d.sourceLang}->${d.targetLang}`)
    if (me.user.email !== 'e2e@example.com' || decks.length !== 1 || decks[0] !== 'German en->de') {
      throw new Error(`Unexpected first-run state: ${me.user.email} ${JSON.stringify(decks)} (is the e2e D1 state really fresh?)`)
    }
  } finally {
    await ctx.dispose()
  }
}
