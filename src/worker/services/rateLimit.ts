/**
 * Daily AI budget (PLAN.md section 4): only cache misses count. Each user may send
 * AI_USER_DAILY_LIMIT words a day to the model and the whole app AI_GLOBAL_DAILY_LIMIT.
 * Days are UTC; usage lives in ai_usage(scope, day, words, calls) with scopes
 * 'user:<id>' and 'global'.
 *
 * Race safety: consumption is ONE guarded upsert that writes both scope rows or neither. Its
 * SELECT reads ai_usage, so SQLite evaluates it completely before writing; with D1 running one
 * statement at a time, two concurrent requests can never both pass the same remaining budget.
 */

export type Limits = { user: number; global: number }

export type Budget = {
  /** Words this request may send to the model right now (0 = rate limited). */
  allowed: number
  /** Next UTC midnight (ms). */
  resetsAt: number
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function nextUtcMidnight(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

export function limitsFrom(env: { AI_USER_DAILY_LIMIT?: string; AI_GLOBAL_DAILY_LIMIT?: string }): Limits {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
  }
  return { user: num(env.AI_USER_DAILY_LIMIT, 200), global: num(env.AI_GLOBAL_DAILY_LIMIT, 2000) }
}

const userScope = (userId: string) => `user:${userId}`

/** ONE query: how many of `wanted` words the user may send today. */
export async function checkBudget(db: D1Database, userId: string, wanted: number, limits: Limits, now: number): Promise<Budget> {
  const resetsAt = nextUtcMidnight(now)
  if (wanted <= 0) return { allowed: 0, resetsAt }
  const { results } = await db
    .prepare('SELECT scope, words FROM ai_usage WHERE day = ? AND scope IN (?, ?)')
    .bind(utcDay(now), userScope(userId), 'global')
    .all<{ scope: string; words: number }>()
  const used = (scope: string) => results.find((r) => r.scope === scope)?.words ?? 0
  const allowed = Math.max(0, Math.min(wanted, limits.user - used(userScope(userId)), limits.global - used('global')))
  return { allowed, resetsAt }
}

/**
 * ONE statement: add `words` (and one call) to both the user's and the global row for today,
 * only if neither would exceed its limit. Returns false (nothing written) otherwise.
 */
export async function consumeBudget(db: D1Database, userId: string, words: number, limits: Limits, now: number): Promise<boolean> {
  if (words <= 0) return true
  const { results } = await db
    .prepare(
      `INSERT INTO ai_usage (scope, day, words, calls)
       SELECT s.value, ?1, ?2, 1 FROM json_each(?3) s
       WHERE ?2 <= ?5 AND ?2 <= ?6
         AND NOT EXISTS (SELECT 1 FROM ai_usage u WHERE u.day = ?1
                         AND ((u.scope = ?4 AND u.words + ?2 > ?5) OR (u.scope = 'global' AND u.words + ?2 > ?6)))
       ON CONFLICT(scope, day) DO UPDATE SET words = words + excluded.words, calls = calls + 1
       RETURNING scope`,
    )
    .bind(utcDay(now), words, JSON.stringify([userScope(userId), 'global']), userScope(userId), limits.user, limits.global)
    .all<{ scope: string }>()
  return results.length === 2
}
