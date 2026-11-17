/** D1 accepts at most 100 bound parameters per statement (PLAN.md section 3). */
export const MAX_IN_KEYS = 90

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

/** Run `SELECT ... WHERE col IN (<keys>)` in chunks of MAX_IN_KEYS and concatenate the rows. */
export async function selectIn<T>(
  db: D1Database,
  keys: readonly string[],
  sql: (inList: string) => string,
  before: readonly unknown[] = [],
): Promise<T[]> {
  const unique = [...new Set(keys)]
  const out: T[] = []
  for (const part of chunk(unique, MAX_IN_KEYS - before.length)) {
    const { results } = await db
      .prepare(sql(placeholders(part.length)))
      .bind(...before, ...part)
      .all<T>()
    out.push(...results)
  }
  return out
}

export function parseJsonArray(json: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
