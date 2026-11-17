/** Zod schemas and DTO types shared by the Worker and the client. */
import { z } from 'zod'
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

export type ApiError = { error: string; message?: string; issues?: unknown }
