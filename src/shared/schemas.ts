/** Zod schemas and DTO types shared by the Worker and the client. */
import { z } from 'zod'
import type { CardContent } from './display'
import { LANGUAGE_CODES } from './languages'

export const LanguageCodeSchema = z.enum(LANGUAGE_CODES)

// ---------- user settings ----------

/** 'target-source' = target language (e.g. German) shown on the front. */
export const StudyDirectionSchema = z.enum(['target-source', 'source-target', 'mixed'])
export type StudyDirection = z.infer<typeof StudyDirectionSchema>

export const UserSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  ttsAutoplay: z.boolean(),
  studyDirection: StudyDirectionSchema,
  hideSentenceOnFront: z.boolean(),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  ttsAutoplay: false,
  studyDirection: 'target-source',
  hideSentenceOnFront: false,
}

// ---------- deck settings ----------

export const SentenceLevelSchema = z.enum(['A1-A2', 'B1-B2', 'C1-C2'])
export type SentenceLevel = z.infer<typeof SentenceLevelSchema>

export const DeckSettingsSchema = z.object({
  dailyNewLimit: z.number().int().min(0).max(200),
  sentenceLevel: SentenceLevelSchema,
  skipTopN: z.number().int().min(0).max(50_000),
})
export type DeckSettings = z.infer<typeof DeckSettingsSchema>

export const DEFAULT_DECK_SETTINGS: DeckSettings = { dailyNewLimit: 10, sentenceLevel: 'A1-A2', skipTopN: 0 }

/**
 * Parse a stored settings_json blob leniently: unknown keys are dropped and each
 * invalid/missing field falls back to its default, so old rows never break the API.
 */
export function parseSettings<T extends Record<string, unknown>>(
  schema: z.ZodObject,
  defaults: T,
  json: string | null | undefined,
): T {
  let raw: unknown
  try {
    raw = JSON.parse(json ?? '{}')
  } catch {
    raw = {}
  }
  const out: Record<string, unknown> = { ...defaults }
  if (raw && typeof raw === 'object') {
    for (const [key, field] of Object.entries(schema.shape)) {
      const r = (field as z.ZodType).safeParse((raw as Record<string, unknown>)[key])
      if (r.success) out[key] = r.data
    }
  }
  return out as T
}

// ---------- request bodies ----------

const DeckNameSchema = z.string().trim().min(1).max(60)

export const UpdateMeSchema = z
  .object({
    displayName: z.string().trim().max(60).nullable().optional(),
    settings: UserSettingsSchema.partial().strict().optional(),
  })
  .strict()
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>

export const CreateDeckSchema = z
  .object({
    name: DeckNameSchema,
    sourceLang: LanguageCodeSchema,
    targetLang: LanguageCodeSchema,
    settings: DeckSettingsSchema.partial().strict().optional(),
  })
  .strict()
  .refine((d) => d.sourceLang !== d.targetLang, {
    message: 'sourceLang and targetLang must differ',
    path: ['targetLang'],
  })
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>

/** The language pair is fixed at creation; only name and settings can change. */
export const UpdateDeckSchema = z
  .object({
    name: DeckNameSchema.optional(),
    settings: DeckSettingsSchema.partial().strict().optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.settings !== undefined, { message: 'Nothing to update' })
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>

export const DeckIdParamSchema = z.object({ id: z.string().min(1).max(64) })

export const CardIdParamSchema = z.object({ id: z.string().min(1).max(64) })

export const InputLangSchema = z.enum(['target', 'source', 'auto'])

/** POST /decks/:id/import. Row limits (500 rows, 100 chars) are enforced by parseImport. */
export const ImportSchema = z
  .object({
    text: z.string().max(200_000),
    filename: z.string().max(255).optional(),
    inputLang: InputLangSchema,
  })
  .strict()
export type ImportInput = z.infer<typeof ImportSchema>

export const CARD_STATUSES = ['pending', 'ready', 'failed', 'suspended', 'deleted', 'duplicate'] as const
export const CardStatusSchema = z.enum(CARD_STATUSES)
export type CardStatus = z.infer<typeof CardStatusSchema>

/** Statuses the card list can filter on. Without a filter, duplicates (and deleted cards) are excluded. */
export const ListableStatusSchema = z.enum(['pending', 'ready', 'failed', 'suspended', 'duplicate'])

export const CardListQuerySchema = z.object({
  status: ListableStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type CardListQuery = z.infer<typeof CardListQuerySchema>

// ---------- response DTOs ----------

export type UserDTO = {
  id: string
  email: string
  displayName: string | null
  settings: UserSettings
  createdAt: number
}

export type DeckDTO = {
  id: string
  name: string
  sourceLang: string
  targetLang: string
  settings: DeckSettings
  createdAt: number
}

export type MeResponse = { user: UserDTO; decks: DeckDTO[] }

export type CardRef = { id: string; display: string }

export type CardDTO = {
  id: string
  deckId: string
  status: CardStatus
  /** What to show for the word: the resolved lemma (with article) once ready, else the input term. */
  display: string
  inputTerm: string
  inputHint: string | null
  inputLang: z.infer<typeof InputLangSchema>
  /** Main translation once resolved; null while pending. */
  translation: string | null
  extraTranslations: string[]
  /** Generated content (entry merged with the card's override); null while pending/failed. */
  content: CardContent | null
  /** Why generation failed ('not_a_word', or the last error), for failed cards. */
  genError: string | null
  duplicateOf?: CardRef
  /** Other ready cards sharing a gloss (<= 3); only on GET /cards/:id (and M5's /learn, /review). */
  alsoInDeck?: CardRef[]
  state: number
  due: number
  createdAt: number
}

export type CardListResponse = { cards: CardDTO[]; nextCursor: string | null }

/** docs/DUPLICATES.md section 10.6. */
export type DuplicateReport = {
  input: string
  hint?: string
  line?: number
  reason: 'in_file' | 'in_deck' | 'resolved'
  existing: { id: string; display: string; status: CardStatus }
  addedTranslation: string | null
}

export type InvalidImportRow = { line: number; term: string; reason: 'empty_term' | 'too_long' }

/** `added` = cards inserted by this import (= ready + pending). */
export type ImportResponse = {
  added: number
  ready: number
  pending: number
  invalid: InvalidImportRow[]
  duplicates: DuplicateReport[]
}

/** Basic deck counts (M3). Duplicate and deleted cards are never counted. */
export type DeckStats = {
  total: number
  ready: number
  pending: number
  failed: number
  suspended: number
  /** Ready cards never studied (FSRS state New). */
  new: number
  /** Ready cards in Learning or Relearning. */
  learning: number
  /** Ready cards in Review. */
  review: number
  /** Ready, already-studied cards due now. */
  dueNow: number
  /** Cards reported as duplicates (for the Home banner); not part of `total`. */
  duplicates: number
}

/** POST /decks/:id/generate (PLAN section 4, DUPLICATES.md 10.6). Duplicates count toward `processed`. */
export type GenerateResponse = {
  /** Cards that left 'pending' in this call: ready + duplicate + failed. */
  processed: number
  /** Resolved from the shared cache (entry_aliases), no AI call. */
  fromCache: number
  /** Resolved by the AI call. */
  generated: number
  /** Cards that became 'failed' (not a word, or 3 failed attempts). */
  failed: number
  /** Cards still pending in the deck after this call. */
  remaining: number
  /** True when the daily AI limit stopped some cards from being generated. */
  rateLimited: boolean
  /** When the daily limit resets (ms since epoch, next UTC midnight); set when rateLimited. */
  limitResetsAt?: number
  duplicates: DuplicateReport[]
}

export type RetryFailedResponse = { retried: number }

export type CardResponse = { card: CardDTO }

export type ApiError = { error: string; message?: string; issues?: unknown }
