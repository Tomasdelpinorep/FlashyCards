/**
 * Generate the seed migrations from the curated en -> de dictionary (src/worker/ai/curated.de.ts)
 * and the lemma list it must cover (data/seed/de/lemmas.json):
 *
 *   npm run seed:sql     # rewrites every SEED_STAGES file (0003_seed_de.sql, 0005_seed_de_a2.sql)
 *
 * Stages: the first migration holds the whole dictionary of its time; each later one only the
 * entries and alias rows that are new or changed since the stage before (curatedDeltaSql), since
 * D1 never re-runs an applied migration. Applying them in order gives the full dictionary.
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
 *   - with `keyVariants` (the stages after 0003): every key also without final punctuation or
 *     ellipsis ("es tut mir leid" finds "Es tut mir leid."), with ASCII apostrophes ("i'm sorry"),
 *     and a reflexive lemma without "sich " ("anmelden"). A variant never beats a real key; on the
 *     target side it silently yields to one.
 *   - `targetAliases`: extra target keys for an existing entry ("sich fühlen" -> fühlen)
 * The alias primary key allows one entry per key: a primary translation beats an alternative,
 * then the lower rank (position in lemmas.json; entries outside it come after) wins. Source-side
 * conflicts are reported; ANY target-side collision fails the script, and so does an entry that
 * does not survive ItemSchema + validateItem unchanged, or a listed lemma without an entry.
 *
 * Every statement stays far below D1's 100 KB statement limit (checked).
 */
import { readFileSync, writeFileSync } from 'node:fs'
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

type Claim = { lemmaKey: string; primary: boolean; rank: number; lemma: string; variant: boolean }
type AliasRow = [side: string, key: string, lemmaKey: string]
type Plan = { entries: readonly CuratedEntry[]; aliasRows: AliasRow[]; conflicts: string[] }
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

export type CuratedSqlOptions = {
  /** Word-list rank by lemma key (data/wordlists/de.json); default: the position in `lemmas`. */
  ranks?: ReadonlyMap<string, number>
  /** Hand-picked winners of source-side conflicts: alias key -> lemma (must be a claimant). */
  winners?: Readonly<Record<string, string>>
  /** Also claim key variants (see the header): no final punctuation, ASCII apostrophes, no "sich ". */
  keyVariants?: boolean
  /** Extra target alias keys: alias -> lemma of an existing entry. */
  targetAliases?: Readonly<Record<string, string>>
}

/** Variants of an alias key: without final punctuation/ellipsis, with ASCII apostrophes. */
function variantsOf(key: string): string[] {
  const out = new Set<string>()
  for (const k of [key, key.replace(/[\s.!?…]+$/u, '')]) for (const x of [k, k.replace(/’/g, "'")]) out.add(x)
  out.delete(key)
  return [...out].filter(Boolean)
}

/** The entries and alias rows of `entries`, which must cover every lemma of `lemmas` (throws on any problem). */
function planCurated(entries: readonly CuratedEntry[], lemmas: readonly string[], opts: CuratedSqlOptions = {}): Plan {
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
    const same = list.find((x) => x.lemmaKey === c.lemmaKey)
    if (!same) list.push(c)
    else {
      same.primary ||= c.primary
      same.variant &&= c.variant
    }
    claims.set(k, list)
  }
  const variants = (keys: readonly string[]) => (opts.keyVariants ? keys.flatMap(variantsOf) : [])
  entries.forEach((e, i) => {
    const lemmaKey = termKey('de', e.lemma!)
    const base = { lemmaKey, rank: rankOf(e, i), lemma: e.lemma! }
    const targetKeys = [lemmaKey, ...(extraTargetKeys.get(e) ?? [])]
    for (const k of targetKeys) claim('target', k, { ...base, primary: true, variant: false })
    const bare = opts.keyVariants && lemmaKey.startsWith('sich ') ? [lemmaKey.slice(5)] : []
    for (const k of [...variants(targetKeys), ...bare]) claim('target', k, { ...base, primary: true, variant: true })
    ;[e.translation!, ...e.alt_translations].forEach((t, j) => {
      const keys = [termKey('en', t), glossKey('en', t)]
      for (const k of keys) claim('source', k, { ...base, primary: j === 0, variant: false })
      for (const k of variants(keys)) claim('source', k, { ...base, primary: j === 0, variant: true })
    })
  })
  for (const [alias, lemma] of Object.entries(opts.targetAliases ?? {})) {
    const i = entries.findIndex((e) => e.lemma === lemma)
    if (i < 0) problems.push(`target alias "${alias}": no entry "${lemma}"`)
    else claim('target', termKey('de', alias), { lemmaKey: termKey('de', lemma), rank: rankOf(entries[i]!, i), lemma, primary: true, variant: false })
  }

  const conflicts: string[] = []
  const unusedWinners = new Set(Object.keys(opts.winners ?? {}))
  const aliasRows: AliasRow[] = []
  for (const [k, list] of [...claims].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [side, key] = k.split('\u0000') as ['target' | 'source', string]
    list.sort((a, b) => Number(a.variant) - Number(b.variant) || Number(b.primary) - Number(a.primary) || a.rank - b.rank)
    const chosen = side === 'source' ? opts.winners?.[key] : undefined
    if (chosen !== undefined) {
      const i = list.findIndex((c) => c.lemma === chosen)
      if (i < 0) problems.push(`winner "${chosen}" for "${key}" is not one of its entries`)
      else list.unshift(...list.splice(i, 1))
      unusedWinners.delete(key)
    }
    const win = list[0]!
    // A variant yields silently to a real key on the target side (the lemma "fühlen" vs "sich fühlen").
    const contenders = side === 'target' && !win.variant ? list.filter((c) => !c.variant) : list
    if (contenders.length > 1) {
      const desc = (c: Claim) => `${c.lemma} (${c.primary ? 'primary' : 'alt'}${c.variant ? ' variant' : ''}, rank ${c.rank})`
      const line = `${side} "${key}": ${desc(win)}${chosen ? ' (chosen)' : ''} beats ${contenders.slice(1).map(desc).join(', ')}`
      if (side === 'target') problems.push(`target-side collision: ${line}`)
      else conflicts.push(line)
    }
    aliasRows.push([side, key, win.lemmaKey])
  }

  for (const k of unusedWinners) problems.push(`winner for "${k}": no such source alias`)
  if (problems.length > 0) throw new Error(`curated dictionary has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  return { entries, aliasRows, conflicts }
}

/**
 * The seed SQL for `entries`, which must cover every lemma of `lemmas` (the word-list forms, in
 * rank order). Pure: the script's main() and the tests call it.
 */
export function curatedToSql(entries: readonly CuratedEntry[], lemmas: readonly string[], opts: CuratedSqlOptions = {}): CuratedSql {
  const plan = planCurated(entries, lemmas, opts)
  const header = `-- The curated en -> de dictionary: ${entries.length} entries, ${plan.aliasRows.length} aliases.`
  return { sql: renderSql(plan.entries, plan.aliasRows, [header]), entries: entries.length, aliases: plan.aliasRows.length, conflicts: plan.conflicts }
}

export type SeedInput = { entries: readonly CuratedEntry[]; lemmas: readonly string[]; opts?: CuratedSqlOptions }

/**
 * The SQL that turns a database seeded with `base` into one seeded with `next`: the entries that
 * are new or changed, the alias rows that are new or point elsewhere (INSERT OR REPLACE), then
 * `trailer`. `next` must keep every base entry and alias key (removals need a hand-written migration).
 */
export function curatedDeltaSql(base: SeedInput, next: SeedInput, trailer?: string): CuratedSql {
  const a = planCurated(base.entries, base.lemmas, base.opts)
  const b = planCurated(next.entries, next.lemmas, next.opts)
  const key = (e: CuratedEntry) => termKey('de', e.lemma!)
  const before = new Map(a.entries.map((e) => [key(e), canonical(e)]))
  const nextKeys = new Set(b.entries.map(key))
  const problems = [...before.keys()].filter((k) => !nextKeys.has(k)).map((k) => `entry "${k}" was removed`)
  const rowId = (r: AliasRow) => r.join('\u0000')
  const oldRows = new Set(a.aliasRows.map(rowId))
  const nextAliasKeys = new Set(b.aliasRows.map(([side, k]) => `${side}\u0000${k}`))
  for (const [side, k] of a.aliasRows) if (!nextAliasKeys.has(`${side}\u0000${k}`)) problems.push(`alias ${side} "${k}" was removed`)
  if (problems.length > 0) throw new Error(`seed delta: ${problems.join('; ')}`)

  const entries = b.entries.filter((e) => before.get(key(e)) !== canonical(e))
  const aliasRows = b.aliasRows.filter((r) => !oldRows.has(rowId(r)))
  const oldConflicts = new Set(a.conflicts)
  const header = `-- Additions to the curated en -> de dictionary (on top of the earlier seed migrations): ${entries.length} entries, ${aliasRows.length} aliases.`
  return {
    sql: renderSql(entries, aliasRows, [header], trailer),
    entries: entries.length,
    aliases: aliasRows.length,
    conflicts: b.conflicts.filter((c) => !oldConflicts.has(c)),
  }
}

function renderSql(entries: readonly CuratedEntry[], aliasRows: readonly AliasRow[], header: string[], trailer?: string): string {
  const out = ['-- Generated by scripts/curated-to-sql.ts (npm run seed:sql) from src/worker/ai/curated.de.ts. Do not edit by hand.', ...header]
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
  if (trailer) out.push(trailer.trimEnd())
  for (const s of out) {
    const bytes = new TextEncoder().encode(s).length
    if (bytes > MAX_STATEMENT_BYTES) throw new Error(`a statement is ${bytes} bytes (limit ${MAX_STATEMENT_BYTES})`)
  }
  return out.join('\n') + '\n'
}

/** The lemma list the dictionary must cover (data/seed/de/lemmas.json), in rank order. */
export function readSeedLemmas(): string[] {
  const raw = JSON.parse(readFileSync(join(root, 'data', 'seed', 'de', 'lemmas.json'), 'utf8')) as unknown
  const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[]; lemmas?: unknown[] }).items ?? (raw as { lemmas?: unknown[] }).lemmas ?? [])
  return items.map((x) => (typeof x === 'string' ? x : (x as { lemma: string }).lemma))
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

/**
 * Source-side picks for conflicts batch-4 (A2 words and phrases) introduced, where the rule would
 * let a new entry take a word an older one answers better (docs/DECISIONS.md).
 */
export const A2_SOURCE_WINNERS: Readonly<Record<string, string>> = {
  'on time': 'pünktlich', // rechtzeitig is "in (good) time"
  rubbish: 'Müll', // the literal word; Mist is colloquial
  usually: 'meistens', // not sonst ("otherwise")
}

/** Target keys of the A2 import list that an existing entry already covers. */
export const A2_TARGET_ALIASES: Readonly<Record<string, string>> = {
  'sich fühlen': 'fühlen', // the fühlen entry covers sich fühlen (see its note)
}

/**
 * Cards still waiting for a meaning get another dictionary lookup: /generate serves the new
 * entries and marks the rest needs_meaning again. A card with a user meaning is left alone.
 */
export const REQUEUE_NEEDS_MEANING_SQL = `-- Re-queue en -> de cards waiting for a meaning, so /generate looks them up in the dictionary again.
UPDATE cards SET status = 'pending', gen_error = NULL, gen_attempts = 0, gen_claimed_at = NULL,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE status = 'failed' AND gen_error = 'needs_meaning' AND override_json IS NULL
  AND deck_id IN (SELECT id FROM decks WHERE source_lang = 'en' AND target_lang = 'de');`

/** One seed migration: its file and the dictionary it brings the database to. */
export type SeedStage = { file: string; input: () => Promise<SeedInput>; trailer?: string }

const curated = () => import('../src/worker/ai/curated.de')

/** The seed migrations, in order. Never change an applied stage's output: add a stage instead. */
export const SEED_STAGES: readonly SeedStage[] = [
  {
    file: '0003_seed_de.sql',
    input: async () => ({ entries: (await curated()).CURATED_DE_BASE, lemmas: readSeedLemmas(), opts: { ranks: readWordRanks(), winners: SOURCE_WINNERS } }),
  },
  {
    file: '0005_seed_de_a2.sql',
    input: async () => ({
      entries: (await curated()).CURATED_DE,
      lemmas: readSeedLemmas(),
      opts: { ranks: readWordRanks(), winners: { ...SOURCE_WINNERS, ...A2_SOURCE_WINNERS }, keyVariants: true, targetAliases: A2_TARGET_ALIASES },
    }),
    trailer: REQUEUE_NEEDS_MEANING_SQL,
  },
]

export const seedSqlPath = (file: string) => join(root, 'migrations', file)

/** Every stage's SQL, in order (main() and curated.test.ts). */
export async function seedStagesSql(): Promise<{ file: string; result: CuratedSql }[]> {
  const out: { file: string; result: CuratedSql }[] = []
  let prev: SeedInput | null = null
  for (const stage of SEED_STAGES) {
    const input = await stage.input()
    const result = prev ? curatedDeltaSql(prev, input, stage.trailer) : curatedToSql(input.entries, input.lemmas, input.opts)
    out.push({ file: stage.file, result })
    prev = input
  }
  return out
}

/** The whole current dictionary as one migration's SQL (what the stages add up to). */
export async function fullSeedSql(): Promise<CuratedSql> {
  const last = await SEED_STAGES.at(-1)!.input()
  return curatedToSql(last.entries, last.lemmas, last.opts)
}

async function main() {
  for (const { file, result } of await seedStagesSql()) {
    writeFileSync(seedSqlPath(file), result.sql)
    for (const c of result.conflicts) console.log(`alias conflict: ${c}`)
    console.log(`${file}: ${result.entries} entries, ${result.aliases} aliases, ${result.conflicts.length} new source-side conflicts`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
