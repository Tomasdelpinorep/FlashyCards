/**
 * Sentence generator abstraction (PLAN.md section 2). One call handles a batch of inputs
 * (the cache misses of one /generate request) and returns one item per input.
 *
 * Implementations: AnthropicGenerator (Claude Haiku 5.5, structured outputs) and FakeGenerator
 * (deterministic, for tests and local development). `createGenerator` (ai/create.ts) picks one.
 */
import type { LanguageCode } from '../../shared/languages'
import type { SentenceLevel } from '../../shared/schemas'
import type { InputLang } from '../../shared/parseImport'
import type { GeneratedItem } from './schema'

export type GenerationInput = {
  /** The word as the user typed it. */
  input: string
  /** Optional meaning hint / translation the user gave (source language). */
  hint: string | null
  /** Which language the input is in; 'auto' = unknown, the model decides. */
  inputLang: InputLang
  /**
   * Expected part of speech (suggested words: the word list's POS). Sent to the model only; it is
   * never stored as the card's hint, so it cannot change hint_key / duplicate semantics.
   */
  pos?: string | null
}

/** One call asking the model for new words when the target language has no bundled word list. */
export type SuggestWordsRequest = {
  sourceLang: LanguageCode
  targetLang: LanguageCode
  level: SentenceLevel
  /** How many words to ask for (the caller asks for count x 1.2 and filters). */
  count: number
  /** lemma keys (lowercased dictionary forms) already in the deck; at most 500. */
  exclude: string[]
}

export type SuggestedWord = { lemma: string; pos: string | null }

export type GenerationRequest = {
  sourceLang: LanguageCode
  targetLang: LanguageCode
  level: SentenceLevel
  items: GenerationInput[]
}

export interface SentenceGenerator {
  /** Stored in entries.model. */
  readonly model: string
  generate(request: GenerationRequest): Promise<GeneratedItem[]>
  /** Common target-language words not in `exclude`, most frequent first (AI fallback for /suggest). */
  suggestWords(request: SuggestWordsRequest): Promise<SuggestedWord[]>
}

/**
 * A failed generation call. `retryable` errors (429, 5xx, network) leave cards pending and count
 * an attempt; the others count an attempt too (so a card can never loop forever), see
 * services/generation.ts.
 */
export class GeneratorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GeneratorError'
  }
}
