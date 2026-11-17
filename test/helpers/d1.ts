/**
 * Minimal D1-compatible adapter over Node's built-in `node:sqlite`, for running worker
 * tests in plain Node (see docs/DECISIONS.md, M2). Implements the subset of the D1 API the
 * app uses: prepare/bind/first/all/run/raw, batch (transactional) and exec.
 * Every database is in-memory and has all migrations/*.sql applied, in order.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

function toSqlValue(v: unknown): SQLInputValue {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a supported bind value')
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  return v as SQLInputValue
}

/** D1 returns plain objects; node:sqlite returns null-prototype objects. */
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

function meta(changes = 0, lastRowId = 0) {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  }
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toSqlValue))
  }

  private stmt(): StatementSync {
    return this.db.prepare(this.sql)
  }

  /** Synchronous core used by both the async API and batch(). */
  execute() {
    const stmt = this.stmt()
    // Statements that return rows (SELECT, ... RETURNING) go through all(); others through run().
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...this.params).map((r) => plain<Record<string, unknown>>(r))
      const changes = Number((this.db.prepare('SELECT changes() AS c').get() as { c: number }).c)
      return { results: rows, success: true as const, meta: meta(/^\s*select/i.test(this.sql) ? 0 : changes) }
    }
    const r = stmt.run(...this.params)
    return { results: [], success: true as const, meta: meta(Number(r.changes), Number(r.lastInsertRowid)) }
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute().results[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async all<T = Record<string, unknown>>() {
    const r = this.execute()
    return { ...r, results: r.results as T[] }
  }

  async run<T = Record<string, unknown>>() {
    return this.all<T>()
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const stmt = this.stmt()
    const cols = stmt.columns().map((c) => c.name)
    const rows = stmt.all(...this.params).map((r) => cols.map((c) => (r as Record<string, unknown>)[c]))
    return (options?.columnNames ? [cols, ...rows] : rows) as T[]
  }
}

class Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new Statement(this.sqlite, sql)
  }

  /** Like D1: all statements run in one transaction; any failure rolls back all of them. */
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN')
    try {
      const results = statements.map((s) => s.execute())
      this.sqlite.exec('COMMIT')
      return results
    } catch (err) {
      this.sqlite.exec('ROLLBACK')
      throw err
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql)
    return { count: 0, duration: 0 }
  }

  withSession() {
    return this
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() is not supported by the test adapter')
  }
}

export type TestD1 = { db: D1Database; sqlite: DatabaseSync }

/** Fresh in-memory database with every migration applied. */
export function createTestD1(): TestD1 {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON') // D1 enforces foreign keys
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return { db: new Database(sqlite) as unknown as D1Database, sqlite }
}
