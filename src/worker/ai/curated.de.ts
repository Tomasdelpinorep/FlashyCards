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
import batch1 from '../../../data/seed/de/batch-1.json'
import batch2 from '../../../data/seed/de/batch-2.json'
import batch3 from '../../../data/seed/de/batch-3.json'
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

/**
 * To change the dictionary: edit devLexicon.de.ts or a batch file (and data/seed/de/lemmas.json
 * when the covered word list changes), then `npm run seed:sql` and commit the regenerated
 * migrations/0003_seed_de.sql (curated.test.ts fails while the two disagree).
 */
export const CURATED_DE: readonly CuratedEntry[] = buildCurated([DEV_LEXICON_DE, json(batch1), json(batch2), json(batch3)])
