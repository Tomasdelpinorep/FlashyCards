/**
 * The curated en -> de dictionary: the single source of truth for German entries (no runtime AI;
 * docs/DECISIONS.md "No-AI dictionary"). Hand-written, checked entries in the generator's item
 * shape (schema.ts ItemSchema without input/input_side/status):
 *
 *   - src/worker/ai/devLexicon.de.ts (the first word-list lemmas plus common extras)
 *   - data/seed/de/batch-{1,2,3}.json (the rest of the 600 word-list lemmas)
 *   - data/seed/de/batch-4.json (A2 everyday words and set phrases, "Es tut mir leid.")
 *
 * scripts/curated-to-sql.ts turns it into the seed migrations (the shared cache, so /generate
 * serves these words without AI): migrations/0003_seed_de.sql holds CURATED_DE_BASE,
 * migrations/0005_seed_de_a2.sql only what batch-4 adds. The FakeGenerator answers from it in dev/e2e.
 * test/worker/curated.test.ts validates every entry.
 *
 * CURATED_ES_DE (at the end) is the same dictionary with Spanish meanings: es -> de.
 */
import { termKey } from '../../shared/normalize'
import batch1 from '../../../data/seed/de/batch-1.json'
import batch2 from '../../../data/seed/de/batch-2.json'
import batch3 from '../../../data/seed/de/batch-3.json'
import batch4 from '../../../data/seed/de/batch-4.json'
import esBatch1 from '../../../data/seed/de/es/batch-1.json'
import esBatch2 from '../../../data/seed/de/es/batch-2.json'
import esBatch3 from '../../../data/seed/de/es/batch-3.json'
import esBatch4 from '../../../data/seed/de/es/batch-4.json'
import esDev from '../../../data/seed/de/es/dev.json'
import { DEV_LEXICON_DE, type DevEntry } from './devLexicon.de'

export type CuratedEntry = DevEntry

/** Concatenate the sources; throws when two entries share a lemma key (one entry per lemma). */
export function buildCurated(sources: readonly (readonly CuratedEntry[])[]): readonly CuratedEntry[] {
  const seen = new Map<string, string>()
  const out: CuratedEntry[] = []
  for (const source of sources) {
    for (const e of source) {
      const lemma = e.lemma?.trim()
      if (!lemma) throw new Error('curated dictionary: an entry has no lemma')
      const key = termKey('de', lemma)
      const prev = seen.get(key)
      if (prev !== undefined) throw new Error(`curated dictionary: duplicate lemma key "${key}" (${prev} / ${lemma})`)
      seen.set(key, lemma)
      out.push(e)
    }
  }
  return out
}

/** JSON data in the entry shape (validated by test/worker/curated.test.ts and the seed script). */
const json = (data: unknown) => data as readonly CuratedEntry[]

/** The entries of migrations/0003_seed_de.sql (already applied: never edit these sources' output). */
export const CURATED_DE_BASE: readonly CuratedEntry[] = buildCurated([DEV_LEXICON_DE, json(batch1), json(batch2), json(batch3)])

/**
 * The whole dictionary. To add words: put them in a new batch file, add a stage to SEED_STAGES in
 * scripts/curated-to-sql.ts (a new migration with only the additions), `npm run seed:sql`, and
 * commit the regenerated migrations (curated.test.ts fails while they disagree).
 */
export const CURATED_DE: readonly CuratedEntry[] = buildCurated([CURATED_DE_BASE, json(batch4)])

/** The Spanish side of one curated entry (data/seed/de/es/*.json, joined on the exact German lemma). */
export type SpanishSide = {
  lemma: string
  translation: string
  alt_translations: string[]
  example_source: string | null
  note: string | null
}

/**
 * The German entries with Spanish meanings, examples and notes (es -> de; docs/DECISIONS.md
 * "App language"). Everything German (lemma, grammar, example_target) is shared with CURATED_DE.
 * Throws when a file and its German source disagree (count, order or lemma).
 */
export function withSpanish(german: readonly CuratedEntry[], spanish: readonly SpanishSide[], file: string): CuratedEntry[] {
  if (german.length !== spanish.length) throw new Error(`${file}: ${spanish.length} Spanish items for ${german.length} German entries`)
  return german.map((g, i) => {
    const es = spanish[i]!
    if (es.lemma !== g.lemma) throw new Error(`${file}: item ${i} is "${es.lemma}", expected "${g.lemma}"`)
    return {
      ...g,
      translation: es.translation,
      alt_translations: es.alt_translations,
      example_source: es.example_source,
      grammar: g.grammar ? { ...g.grammar, note: es.note } : g.grammar,
    }
  })
}

const es = (data: unknown) => data as readonly SpanishSide[]

/** The whole es -> de dictionary (migrations/0006_seed_es_de.sql). */
export const CURATED_ES_DE: readonly CuratedEntry[] = buildCurated([
  withSpanish(DEV_LEXICON_DE, es(esDev), 'es/dev.json'),
  withSpanish(json(batch1), es(esBatch1), 'es/batch-1.json'),
  withSpanish(json(batch2), es(esBatch2), 'es/batch-2.json'),
  withSpanish(json(batch3), es(esBatch3), 'es/batch-3.json'),
  withSpanish(json(batch4), es(esBatch4), 'es/batch-4.json'),
])
