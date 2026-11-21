/**
 * Claude Haiku 5.5 generator (PLAN.md "User decisions" and section 5).
 *
 * - Structured outputs: `client.messages.parse` with `zodOutputFormat(BatchSchema)`, so the
 *   response is validated against the Zod schema by the SDK (`parsed_output`).
 * - No sampling parameters: Claude Haiku 5.5 rejects non-default `temperature`/`top_p`/`top_k`.
 * - Thinking disabled (PLAN section 1). On Haiku 5.5 `disabled` is accepted at effort
 *   low/medium/high only, so effort is pinned to 'low' (short, formulaic output).
 * - Errors are mapped to GeneratorError: 429, 5xx/529 and connection errors are retryable.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { GeneratorError, type GenerationRequest, type SentenceGenerator, type SuggestedWord, type SuggestWordsRequest } from './generator'
import { suggestSystemPrompt, suggestUserPrompt, systemPrompt, userPrompt } from './prompts'
import { BatchSchema, SuggestBatchSchema, type GeneratedItem } from './schema'

export const DEFAULT_MODEL = 'claude-haiku-5-5'

/** ~250 output tokens per item; a batch is at most 10 items. Generous so a batch never truncates. */
const MAX_TOKENS = 8000
/** /suggest fallback: ~15 output tokens per word, at most 60 words. */
const SUGGEST_MAX_TOKENS = 4000

/** The part of the SDK client this class uses; tests pass a mock. */
export type MessagesClient = Pick<Anthropic, 'messages'>

export class AnthropicGenerator implements SentenceGenerator {
  readonly model: string
  private readonly client: MessagesClient

  constructor(options: { apiKey?: string; model?: string; client?: MessagesClient }) {
    this.model = options.model ?? DEFAULT_MODEL
    // One SDK retry for transient failures; the card-level gen_attempts handles the rest.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1, timeout: 60_000 })
  }

  /** The exact request body sent to the Messages API (exported for tests). */
  buildRequest(req: GenerationRequest) {
    return {
      model: this.model,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' as const },
      output_config: { effort: 'low' as const, format: zodOutputFormat(BatchSchema) },
      system: systemPrompt(req),
      messages: [{ role: 'user' as const, content: userPrompt(req) }],
    }
  }

  async generate(req: GenerationRequest): Promise<GeneratedItem[]> {
    let response
    try {
      response = await this.client.messages.parse(this.buildRequest(req))
    } catch (err) {
      throw toGeneratorError(err)
    }
    if (response.stop_reason === 'refusal') throw new GeneratorError('The model declined the request', false)
    if (response.stop_reason === 'max_tokens') throw new GeneratorError('The response was cut off (max_tokens)', true)
    if (!response.parsed_output) throw new GeneratorError('The response did not match the output schema', true)
    return response.parsed_output.items
  }

  /** The /suggest fallback request: same model and settings, a small word-list schema. */
  buildSuggestRequest(req: SuggestWordsRequest) {
    return {
      model: this.model,
      max_tokens: SUGGEST_MAX_TOKENS,
      thinking: { type: 'disabled' as const },
      output_config: { effort: 'low' as const, format: zodOutputFormat(SuggestBatchSchema) },
      system: suggestSystemPrompt(req),
      messages: [{ role: 'user' as const, content: suggestUserPrompt(req) }],
    }
  }

  async suggestWords(req: SuggestWordsRequest): Promise<SuggestedWord[]> {
    let response
    try {
      response = await this.client.messages.parse(this.buildSuggestRequest(req))
    } catch (err) {
      throw toGeneratorError(err)
    }
    if (response.stop_reason === 'refusal') throw new GeneratorError('The model declined the request', false)
    if (response.stop_reason === 'max_tokens') throw new GeneratorError('The response was cut off (max_tokens)', true)
    if (!response.parsed_output) throw new GeneratorError('The response did not match the output schema', true)
    return response.parsed_output.words
  }
}

/** Map SDK errors to GeneratorError, most specific first (TS: APIConnectionError extends APIError). */
export function toGeneratorError(err: unknown): GeneratorError {
  if (err instanceof GeneratorError) return err
  if (err instanceof Anthropic.RateLimitError) return new GeneratorError('Rate limited by the AI provider', true, 429)
  if (err instanceof Anthropic.APIConnectionError) return new GeneratorError('Could not reach the AI provider', true)
  if (err instanceof Anthropic.APIError) {
    const status = err.status
    const retryable = status === undefined || status === 408 || status === 409 || status >= 500
    return new GeneratorError(`AI provider error ${status ?? ''}`.trim(), retryable, status)
  }
  // Schema validation failures from the SDK's parser and anything unexpected.
  return new GeneratorError(err instanceof Error ? err.message : 'Generation failed', true)
}
