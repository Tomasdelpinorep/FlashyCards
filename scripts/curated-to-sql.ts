/**
 * Generate migrations/0003_seed_de.sql from the curated en -> de dictionary (src/worker/ai/curated.de.ts)
 * and the lemma list it must cover (data/seed/de/lemmas.json):
 *
 *   npm run seed:sql             # -> migrations/0003_seed_de.sql
 *   npm run seed:sql -- 0004     # a later change, once 0003 has run remotely (D1 never re-runs a migration)
 *
 * entries: deterministic ids `cur-de-<lemma_key>`, model 'curated', PROMPT_VERSION, upserted
 * (ON CONFLICT ... DO UPDATE: curated content wins over stale rows, e.g. fake entries in a local
 * dev DB), ENTRIES_PER_INSERT rows per statement.
 * entry_aliases: INSERT OR REPLACE ... SELECT ... FROM (VALUES ...) JOIN entries on lemma_key (the
 * id is looked up, since an upsert keeps an existing row's id), ALIASES_PER_INSERT rows per statement.
 *   - target side: termKey(de, lemma), plus the covered list lemma's key when it differs
 *     ("sich freuen" also answers "freuen")
 *   - source side: termKey(en, t) and glossKey(en, t) of the translation and every alternative
 *     (what lookupAliases compares, plus the gloss form, so "go" finds "to go")
 * The alias primary key allows one entry per key: a primary translation beats an alternative,
 * then the lower rank (position in lemmas.json; entries outside it come after) wins. Source-side
 * conflicts are reported; ANY target-side collision fails the script, and so does an entry that
 * does not survive ItemSchema + validateItem unchanged, or a listed lemma without an entry.
 *
 * Every statement stays far below D1's 100 KB statement limit (checked).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LanguagePair } from '../src/shared/parseImport'
import { glossKey, termKey } from '../src/shared/normalize'
import type { CuratedEntry } from '../src/worker/ai/curated.de'
import { PROMPT_VERSION } from '../src/worker/ai/prompts'
import { ItemSchema } from '../src/worker/ai/schema'
import { validateItem } from '../src/worker/services/generation'

export const ENTRIES_PER_INSERT = 25
export const ALIASES_PER_INSERT = 200
export const MAX_STATEMENT_BYTES = 60_000
export const CURATED_MODEL = 'curated'
/** Fixed created_at, so the generated SQL is reproducible (2026-11-23T00:00:00Z). */
export const SEED_CREATED_AT = 1_795_392_000_000

const PAIR: LanguagePair = { sourceLang: 'en', targetLang: 'de' }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const sql = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)

type Claim = { lemmaKey: string; primary: boolean; rank: number; lemma: string }
export type CuratedSql = { sql: string; entries: number; aliases: number; conflicts: string[] }

/** termKey of a lemma, also without a leading reflexive "sich " (the word list's form). */
function lemmaKeys(lemma: string): string[] {
  const k = termKey('de', lemma)
  return k.startsWith('sich ') ? [k, k.slice(5)] : [k]
}

/** JSON with sorted object keys (key order is not content). */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  )
}

/** Problems (empty when fine): the entry must be a valid item that post-validation leaves unchanged. */
function checkEntry(e: CuratedEntry): string[] {
  const item = { input: e.lemma ?? '', input_side: 'target' as const, status: 'ok' as const, ...e }
  const parsed = ItemSchema.safeParse(item)
  if (!parsed.success) return [`${e.lemma}: not a valid item (${parsed.error.issues.map((i) => i.path.join('.')).join(', ')})`]
  const group = { input: { input: item.input, hint: null, inputLang: 'target' as const }, cards: [{ hintKey: '' }] }
  const v = validateItem(parsed.data, group as unknown as Parameters<typeof validateItem>[1], PAIR)
  if (v.kind !== 'ok') return [`${e.lemma}: rejected by post-validation (${v.kind === 'invalid' ? v.reason : v.kind})`]
  const x = v.entry
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
  const diffs = [
    x.lemma !== e.lemma && 'lemma',
    x.translation !== e.translation && 'translation',
    !same(x.alts, e.alt_translations) && 'alt_translations',
    !same(x.grammar, e.grammar) && 'grammar',
    x.example_target !== e.example_target && 'example_target',
    x.example_source !== e.example_source && 'example_source',
  ].filter(Boolean)
  return diffs.length ? [`${e.lemma}: post-validation changes ${diffs.join(', ')}`] : []
}

/**
 * The seed SQL for `entries`, which must cover every lemma of `lemmas` (the word-list forms, in
 * rank order). Pure: the script's main() and the tests call it.
 */
export type CuratedSqlOptions = {
  /** Word-list rank by lemma key (data/wordlists/de.json); default: the position in `lemmas`. */
  ranks?: ReadonlyMap<string, number>
  /** Hand-picked winners of source-side conflicts: alias key -> lemma (must be a claimant). */
  winners?: Readonly<Record<string, string>>
}

export function curatedToSql(entries: readonly CuratedEntry[], lemmas: readonly string[], opts: CuratedSqlOptions = {}): CuratedSql {
  const problems = entries.flatMap(checkEntry)

  // Lemma key -> entry, and each entry's rank (its position in `lemmas`).
  const byKey = new Map<string, CuratedEntry>()
  for (const e of entries) {
    const k = termKey('de', e.lemma!)
    if (byKey.has(k)) problems.push(`duplicate lemma key "${k}"`)
    byKey.set(k, e)
  }
  const byAnyKey = new Map<string, CuratedEntry>()
  for (const e of entries) for (const k of lemmaKeys(e.lemma!)) if (!byAnyKey.has(k)) byAnyKey.set(k, e)
  const rank = new Map<CuratedEntry, number>()
  const extraTargetKeys = new Map<CuratedEntry, string[]>()
  lemmas.forEach((l, i) => {
    const k = termKey('de', l)
    const e = byKey.get(k) ?? byAnyKey.get(k)
    if (!e) return problems.push(`listed lemma "${l}" has no entry`)
    if (!rank.has(e)) rank.set(e, i + 1)
    if (k !== termKey('de', e.lemma!)) extraTargetKeys.set(e, [...(extraTargetKeys.get(e) ?? []), k])
  })
  const wordRank = (e: CuratedEntry) => lemmaKeys(e.lemma!).map((k) => opts.ranks?.get(k)).find((r) => r !== undefined)
  const rankOf = (e: CuratedEntry, i: number) => wordRank(e) ?? rank.get(e) ?? (opts.ranks ? 1_000_000 : lemmas.length) + 1 + i

  // Alias claims: one winner per (side, key).
  const claims = new Map<string, Claim[]>()
  const claim = (side: 'target' | 'source', key: string, c: Claim) => {
    if (!key) return
    const k = `${side}\u0000${key}`
    const list = claims.get(k) ?? []
    if (!list.some((x) => x.lemmaKey === c.lemmaKey)) list.push(c)
    else if (c.primary) for (const x of list) if (x.lemmaKey === c.lemmaKey) x.primary = true
    claims.set(k, list)
  }
  entries.forEach((e, i) => {
    const lemmaKey = termKey('de', e.lemma!)
    const base = { lemmaKey, rank: rankOf(e, i), lemma: e.lemma! }
    for (const k of [lemmaKey, ...(extraTargetKeys.get(e) ?? [])]) claim('target', k, { ...base, primary: true })
    ;[e.translation!, ...e.alt_translations].forEach((t, j) => {
      for (const k of [termKey('en', t), glossKey('en', t)]) claim('source', k, { ...base, primary: j === 0 })
    })
  })
  const conflicts: string[] = []
  const unusedWinners = new Set(Object.keys(opts.winners ?? {}))
  const aliasRows: [side: string, key: string, lemmaKey: string][] = []
  for (const [k, list] of [...claims].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [side, key] = k.split('\u0000') as ['target' | 'source', string]
    list.sort((a, b) => Number(b.primary) - Number(a.primary) || a.rank - b.rank)
    const chosen = side === 'source' ? opts.winners?.[key] : undefined
    if (chosen !== undefined) {
      const i = list.findIndex((c) => c.lemma === chosen)
      if (i < 0) problems.push(`winner "${chosen}" for "${key}" is not one of its entries`)
      else list.unshift(...list.splice(i, 1))
      unusedWinners.delete(key)
    }
    const win = list[0]!
    if (list.length > 1) {
      const desc = (c: Claim) => `${c.lemma} (${c.primary ? 'primary' : 'alt'}, rank ${c.rank})`
      const line = `${side} "${key}": ${desc(win)}${chosen ? ' (chosen)' : ''} beats ${list.slice(1).map(desc).join(', ')}`
      if (side === 'target') problems.push(`target-side collision: ${line}`)
      else conflicts.push(line)
    }
    aliasRows.push([side, key, win.lemmaKey])
  }

  for (const k of unusedWinners) problems.push(`winner for "${k}": no such source alias`)
  if (problems.length > 0) throw new Error(`curated dictionary has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)

  const out = [
    '-- Generated by scripts/curated-to-sql.ts (npm run seed:sql) from src/worker/ai/curated.de.ts. Do not edit by hand.',
    `-- The curated en -> de dictionary: ${entries.length} entries, ${aliasRows.length} aliases.`,
  ]
  for (let i = 0; i < entries.length; i += ENTRIES_PER_INSERT) {
    const values = entries.slice(i, i + ENTRIES_PER_INSERT).map((e) => {
      const k = termKey('de', e.lemma!)
      return `(${[
        sql(`cur-de-${k}`),
        sql(PAIR.sourceLang),
        sql(PAIR.targetLang),
        sql(e.lemma!),
        sql(k),
        sql(''),
        sql(e.pos),
        sql(e.translation),
        sql(JSON.stringify(e.alt_translations)),
        sql(e.cefr),
        sql(e.grammar ? JSON.stringify(e.grammar) : null),
        sql(e.example_target),
        sql(e.example_source),
        sql(CURATED_MODEL),
        sql(PROMPT_VERSION),
        sql(SEED_CREATED_AT),
      ].join(', ')})`
    })
    out.push(
      `INSERT INTO entries (id, source_lang, target_lang, lemma, lemma_key, sense_key, pos, translation, alt_translations_json, cefr, grammar_json, example_target, example_source, model, prompt_version, created_at) VALUES\n${values.join(',\n')}\n` +
        `ON CONFLICT (source_lang, target_lang, lemma_key, sense_key) DO UPDATE SET lemma = excluded.lemma, pos = excluded.pos, translation = excluded.translation, alt_translations_json = excluded.alt_translations_json, cefr = excluded.cefr, grammar_json = excluded.grammar_json, example_target = excluded.example_target, example_source = excluded.example_source, model = excluded.model, prompt_version = excluded.prompt_version;`,
    )
  }
  for (let i = 0; i < aliasRows.length; i += ALIASES_PER_INSERT) {
    const values = aliasRows.slice(i, i + ALIASES_PER_INSERT).map(([side, key, lk]) => `(${sql(side)}, ${sql(key)}, ${sql(lk)})`)
    out.push(
      `INSERT OR REPLACE INTO entry_aliases (source_lang, target_lang, input_side, alias_key, sense_key, entry_id)\n` +
        `SELECT ${sql(PAIR.sourceLang)}, ${sql(PAIR.targetLang)}, v.column1, v.column2, '', e.id FROM (VALUES\n${values.join(',\n')}\n) v\n` +
        `JOIN entries e ON e.source_lang = ${sql(PAIR.sourceLang)} AND e.target_lang = ${sql(PAIR.targetLang)} AND e.lemma_key = v.column3 AND e.sense_key = '';`,
    )
  }
  for (const s of out) {
    const bytes = new TextEncoder().encode(s).length
    if (bytes > MAX_STATEMENT_BYTES) throw new Error(`a statement is ${bytes} bytes (limit ${MAX_STATEMENT_BYTES})`)
  }
  return { sql: out.join('\n') + '\n', entries: entries.length, aliases: aliasRows.length, conflicts }
}

/** The lemma list the dictionary must cover (data/seed/de/lemmas.json), in rank order. */
export function readSeedLemmas(): string[] {
  const raw = JSON.parse(readFileSync(join(root, 'data', 'seed', 'de', 'lemmas.json'), 'utf8')) as unknown
  const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[]; lemmas?: unknown[] }).items ?? (raw as { lemmas?: unknown[] }).lemmas ?? [])
  return items.map((x) => (typeof x === 'string' ? x : (x as { lemma: string }).lemma))
}

/** The seed migration `number` writes to (default 0003). */
export const seedSqlFile = (number = '0003') => join(root, 'migrations', `${number}_seed_de.sql`)

/** The newest committed seed migration: the one that must match a regeneration. */
export function latestSeedSqlFile(): string {
  const files = readdirSync(join(root, 'migrations')).filter((f) => /^\d+_seed_de\.sql$/.test(f)).sort()
  return join(root, 'migrations', files.at(-1) ?? '0003_seed_de.sql')
}

/** Word-list rank by lemma key (data/wordlists/de.json), the tie-break for alias conflicts. */
export function readWordRanks(): Map<string, number> {
  const list = JSON.parse(readFileSync(join(root, 'data', 'wordlists', 'de.json'), 'utf8')) as { items: { rank: number; lemma: string }[] }
  const out = new Map<string, number>()
  for (const it of list.items) if (!out.has(termKey('de', it.lemma))) out.set(termKey('de', it.lemma), it.rank)
  return out
}

/**
 * Source-side aliases where the rule (primary beats alternative, then word-list rank) picks a
 * worse answer for an English word typed alone (docs/DECISIONS.md, No-AI dictionary).
 */
export const SOURCE_WINNERS: Readonly<Record<string, string>> = {
  boss: 'Chef', // Boss is film-speak
  doctor: 'Arzt',
  idea: 'Idee', // Ahnung is "keine Ahnung"
  information: 'Information', // not Bescheid
  one: 'eins', // the number, not the pronoun man
  right: 'richtig', // the adjective, not das Recht
  sick: 'krank',
  there: 'dort', // da has many meanings
  watch: 'Uhr', // the noun; "to watch" stays sehen
  when: 'wann', // the question word
}

/** The SQL for the real dictionary (main() and curated.test.ts). */
export function seedSql(entries: readonly CuratedEntry[]): CuratedSql {
  return curatedToSql(entries, readSeedLemmas(), { ranks: readWordRanks(), winners: SOURCE_WINNERS })
}

async function main() {
  const { CURATED_DE } = await import('../src/worker/ai/curated.de')
  const result = seedSql(CURATED_DE)
  const file = seedSqlFile(process.argv[2])
  writeFileSync(file, result.sql)
  for (const c of result.conflicts) console.log(`alias conflict: ${c}`)
  console.log(`${result.entries} entries, ${result.aliases} aliases, ${result.conflicts.length} source-side conflicts -> ${file}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
