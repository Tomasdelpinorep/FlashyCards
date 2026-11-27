/** Zod schemas and DTO types shared by the Worker and the client. */
import { z } from 'zod'
import type { CardContent } from './display'
import { DEFAULT_UI_LANGUAGE, LANGUAGE_CODES, UI_LANGUAGES } from './languages'
import type { SrsFields } from './srs'

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
  /** The app language, also the source language of the user's decks (switching converts them). */
  uiLang: z.enum(UI_LANGUAGES),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  ttsAutoplay: false,
  studyDirection: 'target-source',
  hideSentenceOnFront: false,
  uiLang: DEFAULT_UI_LANGUAGE,
}

// ---------- deck settings ----------

export const SentenceLevelSchema = z.enum(['A1-A2', 'B1-B2', 'C1-C2'])
export type SentenceLevel = z.infer<typeof SentenceLevelSchema>

export const DeckSettingsSchema = z.object({
  dailyNewLimit: z.number().int().min(0).max(200),
  sentenceLevel: SentenceLevelSchema,
  skipTopN: z.number().int().min(0).max(50_000),
  /** Imported words skip Learn and go straight to Train (cards.skip_learn). Off for decks made before it existed. */
  importToTrain: z.boolean(),
})
export type DeckSettings = z.infer<typeof DeckSettingsSchema>

/** Fallbacks for settings missing from a stored deck: importToTrain is off, so older decks keep Learn. */
export const DEFAULT_DECK_SETTINGS: DeckSettings = { dailyNewLimit: 10, sentenceLevel: 'A1-A2', skipTopN: 0, importToTrain: false }

/** Settings of a deck created now: imported words go straight to Train. */
export const NEW_DECK_SETTINGS: DeckSettings = { ...DEFAULT_DECK_SETTINGS, importToTrain: true }

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

/** POST /decks/:id/suggest ("Add X new words", M7). */
export const SuggestSchema = z.object({ count: z.number().int().min(1).max(50) }).strict()
export type SuggestInput = z.infer<typeof SuggestSchema>

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

/** Most extra translations a card can hold (also the cap for merges, services/resolve.ts). */
export const MAX_EXTRA_TRANSLATIONS = 10
export const NOTE_MAX = 500

/** An edited text field: trimmed; '' or null removes the override (falls back to the entry). */
const OverrideTextSchema = (max: number) => z.string().trim().max(max).nullable().optional()

/**
 * PATCH /cards/:id (M8): edit what the card shows and/or suspend it. The lemma never changes.
 * Extra translations are trimmed and de-duplicated by gloss key on the server.
 */
export const UpdateCardSchema = z
  .object({
    translation: OverrideTextSchema(100),
    exampleTarget: OverrideTextSchema(300),
    exampleSource: OverrideTextSchema(300),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    extraTranslations: z.array(z.string().trim().max(100)).max(MAX_EXTRA_TRANSLATIONS).optional(),
    status: z.enum(['ready', 'suspended']).optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update' })
export type UpdateCardInput = z.infer<typeof UpdateCardSchema>

/**
 * POST /cards/:id/meaning: the user's own meaning for a word the dictionary doesn't know (a
 * 'failed' card). `word` is the target-language word (a leading article sets the gender);
 * stored in the card's override_json, with no shared entry.
 */
export const MeaningSchema = z
  .object({
    word: z.string().trim().min(1).max(100),
    translation: z.string().trim().min(1).max(100),
    gender: z.enum(['masculine', 'feminine', 'neuter']).nullable().optional(),
    exampleTarget: OverrideTextSchema(300),
    exampleSource: OverrideTextSchema(300),
  })
  .strict()
export type MeaningInput = z.infer<typeof MeaningSchema>

/** The side shown on the front of a reviewed card (review_logs.direction). */
export const ShownDirectionSchema = z.enum(['target-source', 'source-target'])
export type ShownDirection = z.infer<typeof ShownDirectionSchema>

/** Reviews may be posted up to 7 days late (offline outbox); reviewedAt is clamped to [now-7d, now]. */
export const REVIEW_MAX_AGE_MS = 7 * 86_400_000

/** POST /reviews (PLAN section 4). `id` is a client UUID and the idempotency key. */
export const ReviewSchema = z
  .object({
    id: z.uuid(),
    cardId: z.string().min(1).max(64),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    direction: ShownDirectionSchema,
    reviewedAt: z.number().int().nonnegative(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
  })
  .strict()
export type ReviewInput = z.infer<typeof ReviewSchema>

/** Minutes to add to local time to get UTC, as returned by Date#getTimezoneOffset() (UTC+2 -> -120). */
const TzOffsetSchema = z.coerce.number().int().min(-14 * 60).max(14 * 60)

export const ReviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ahead: z.enum(['0', '1']).optional(),
})
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuerySchema>

export const StatsQuerySchema = z.object({ tzOffset: TzOffsetSchema.optional() })

/** How many cards `?extra=N` ("learn more anyway") may add past the daily new limit. */
export const LEARN_EXTRA_MAX = 50

/**
 * GET /decks/:id/learn. `limit` caps the page; the daily cap (dailyNewLimit - newToday) applies
 * unless `extra` is given, which returns up to `extra` New cards regardless of the cap.
 */
export const LearnQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  tzOffset: TzOffsetSchema.optional(),
  extra: z.coerce.number().int().min(1).max(LEARN_EXTRA_MAX).optional(),
})
export type LearnQuery = z.infer<typeof LearnQuerySchema>

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
  /** The learner's own note (M8). */
  note: string | null
  /** Why generation failed ('not_a_word', or the last error), for failed cards. */
  genError: string | null
  duplicateOf?: CardRef
  /** Other ready cards sharing a gloss (<= 3); on GET /cards/:id, /learn and /review. */
  alsoInDeck?: CardRef[]
  state: number
  due: number
  /** The FSRS columns (for interval previews and the in-session requeue). */
  srs: SrsFields
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

/**
 * POST /decks/:id/suggest (DUPLICATES.md 10.6). `added = ready + pending`; `exhausted` = the word
 * list has nothing left for this deck after this request (never set on the AI fallback path).
 */
export type SuggestResponse = {
  added: number
  ready: number
  pending: number
  exhausted: boolean
  duplicates: DuplicateReport[]
}

/** Deck counts (M3, day-based counts M5). Duplicate and deleted cards are never counted. */
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
  /** Ready, already-studied cards due now, including the 20-minute learn-ahead (what Train shows). */
  dueNow: number
  /** Ready, already-studied cards due before the end of the user's local day. */
  dueToday: number
  /** Reviews of this deck's cards since the start of the user's local day. */
  reviewedToday: number
  /** New cards studied for the first time today (their first review was today). */
  newToday: number
  /** Cards reported as duplicates (for the Home banner); not part of `total`. */
  duplicates: number
  /** Failed cards the dictionary doesn't know (gen_error 'needs_meaning'); part of `failed`. Retry skips them. */
  needsMeaning: number
}

/** POST /decks/:id/generate (PLAN section 4, DUPLICATES.md 10.6). Duplicates count toward `processed`. */
export type GenerateResponse = {
  /** Cards that left 'pending' in this call: ready + duplicate + failed. */
  processed: number
  /** Resolved from the shared cache (entry_aliases), no AI call. */
  fromCache: number
  /** Resolved by the AI call. */
  generated: number
  /** Cards that became 'failed' (not a word, not in the dictionary, or 3 failed attempts). */
  failed: number
  /** Of `failed`: words not in the dictionary (no AI), waiting for the user's meaning. */
  needsMeaning: number
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

/** GET /decks/:id/review. `nextDueAt`: when the next studied card is due (null if none). */
export type ReviewQueueResponse = { cards: CardDTO[]; nextDueAt: number | null }

/**
 * GET /decks/:id/learn: ready New cards, oldest first, each with `alsoInDeck`.
 * `remainingToday` = max(0, dailyNewLimit - newToday) (unaffected by `extra`);
 * `readyNewTotal` = every ready New card in the deck ("10 left today · 34 ready").
 */
export type LearnQueueResponse = {
  cards: CardDTO[]
  remainingToday: number
  readyNewTotal: number
  newToday: number
  dailyNewLimit: number
}

/** POST /reviews: the card's schedule after the review (unchanged on a repeated id). */
export type ReviewResponse = {
  card: { id: string; status: CardStatus; srs: SrsFields }
  /** False when this review id had already been applied (idempotent repeat). */
  applied: boolean
}

export type ApiError = { error: string; message?: string; issues?: unknown }
