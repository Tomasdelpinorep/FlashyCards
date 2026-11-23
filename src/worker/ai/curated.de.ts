/**
 * The curated en -> de dictionary: the single source of truth for German entries (no runtime AI;
 * docs/DECISIONS.md "No-AI dictionary"). Hand-written, checked entries in the generator's item
 * shape (schema.ts ItemSchema without input/input_side/status):
 *
 *   - src/worker/ai/devLexicon.de.ts (the first word-list lemmas plus common extras)
 *   - data/seed/de/batch-{1,2,3}.json (the rest of the 600 word-list lemmas)
 *
 * scripts/curated-to-sql.ts turns it into migrations/0003_seed_de.sql (the shared cache, so
 * /generate serves these words without AI), and the FakeGenerator answers from it in dev/e2e.
 * test/worker/curated.test.ts validates every entry.
 */
import { termKey } from '../../shared/normalize'
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

// Phase 2 adds the data/seed/de batch files here.
export const CURATED_DE: readonly CuratedEntry[] = buildCurated([DEV_LEXICON_DE])
