/**
 * Structured-output schema for one batched generation call (PLAN.md section 5, amended by
 * docs/DUPLICATES.md section 10.2: `input_side`, and `[[ ]]` in both example sentences).
 *
 * Kept to what structured outputs support well: objects, strings, enums, booleans, arrays and
 * nullable fields. No length limits in the schema; they are stated in the prompt and enforced
 * by post-validation (services/generation.ts).
 */
import { z } from 'zod'

export const POS_VALUES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'pronoun',
  'conjunction',
  'article',
  'numeral',
  'interjection',
  'phrase',
  'other',
] as const

export const GENDER_VALUES = ['masculine', 'feminine', 'neuter'] as const
export type Gender = (typeof GENDER_VALUES)[number]

export const CEFR_VALUES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

export const VerbFormsSchema = z.object({
  present_3sg: z.string().nullable(),
  past_3sg: z.string().nullable(),
  /** Perfect / compound past, 3rd person singular, as one string ("ist gegangen"). */
  perfect_3sg: z.string().nullable(),
  participle: z.string().nullable(),
  auxiliary: z.string().nullable(),
  separable: z.boolean().nullable(),
  reflexive: z.boolean().nullable(),
})

export const GrammarSchema = z.object({
  gender: z.enum(GENDER_VALUES).nullable(),
  article: z.string().nullable(),
  /** Plural with its article ("die Hunde"). */
  plural: z.string().nullable(),
  genitive: z.string().nullable(),
  verb: VerbFormsSchema.nullable(),
  governs_case: z.string().nullable(),
  comparative: z.string().nullable(),
  superlative: z.string().nullable(),
  note: z.string().nullable(),
})
export type Grammar = z.infer<typeof GrammarSchema>

export const ItemSchema = z.object({
  /** The input exactly as given (used to match outputs to inputs). */
  input: z.string(),
  /** Which language the input was in. */
  input_side: z.enum(['target', 'source']),
  status: z.enum(['ok', 'not_a_word']),
  /** Dictionary form in the target language, without article. */
  lemma: z.string().nullable(),
  pos: z.enum(POS_VALUES).nullable(),
  translation: z.string().nullable(),
  alt_translations: z.array(z.string()),
  cefr: z.enum(CEFR_VALUES).nullable(),
  grammar: GrammarSchema.nullable(),
  /** Target-language sentence; the exact form of the word wrapped in [[ ]]. */
  example_target: z.string().nullable(),
  /** Its translation; the translated word wrapped in [[ ]]. */
  example_source: z.string().nullable(),
})
export type GeneratedItem = z.infer<typeof ItemSchema>

export const BatchSchema = z.object({ items: z.array(ItemSchema) })

/** AI fallback for /suggest (target languages without a word list). */
export const SuggestBatchSchema = z.object({
  words: z.array(z.object({ lemma: z.string(), pos: z.enum(POS_VALUES).nullable() })),
})
export type SuggestBatch = z.infer<typeof SuggestBatchSchema>
export type GeneratedBatch = z.infer<typeof BatchSchema>
