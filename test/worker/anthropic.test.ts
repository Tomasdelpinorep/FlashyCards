import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { CardDTO, CardListResponse, GenerateResponse, MeResponse } from '../../src/shared/schemas'
import { AnthropicGenerator, toGeneratorError, type MessagesClient } from '../../src/worker/ai/anthropic'
import { createGenerator } from '../../src/worker/ai/create'
import { FakeGenerator } from '../../src/worker/ai/fake'
import type { GenerationRequest } from '../../src/worker/ai/generator'
import { PROMPT_VERSION } from '../../src/worker/ai/prompts'
import type { GeneratedItem } from '../../src/worker/ai/schema'
import type { Bindings } from '../../src/worker/env'
import { setup } from '../helpers/app'

const REQ: GenerationRequest = {
  sourceLang: 'en',
  targetLang: 'de',
  level: 'A1-A2',
  items: [
    { input: 'Hund', hint: null, inputLang: 'target' },
    { input: 'big', hint: null, inputLang: 'source' },
    { input: 'Bank', hint: 'bench', inputLang: 'auto' },
  ],
}

const ITEM: GeneratedItem = {
  input: 'Hund',
  input_side: 'target',
  status: 'ok',
  lemma: 'Hund',
  pos: 'noun',
  translation: 'dog',
  alt_translations: ['hound'],
  cefr: 'A1',
  grammar: {
    gender: 'masculine',
    article: 'die', // wrong on purpose: post-validation fixes it from the gender
    plural: 'die Hunde',
    genitive: null,
    verb: null,
    governs_case: null,
    comparative: null,
    superlative: null,
    note: null,
  },
  example_target: 'Der [[Hund]] bellt laut.',
  example_source: 'The [[dog]] barks loudly.',
}

/** A mock of the SDK client's `messages.parse`. */
function mockClient(impl: (body: Record<string, unknown>) => unknown) {
  const parse = vi.fn(async (body: Record<string, unknown>) => impl(body))
  return { client: { messages: { parse } } as unknown as MessagesClient, parse }
}

const ok = (items: GeneratedItem[]) => ({ stop_reason: 'end_turn', parsed_output: { items }, content: [] })

describe('AnthropicGenerator', () => {
  it('sends the expected request: model, structured output format, thinking disabled, no sampling params', async () => {
    const { client, parse } = mockClient(() => ok([ITEM]))
    const gen = new AnthropicGenerator({ client })
    await gen.generate(REQ)
    expect(parse).toHaveBeenCalledTimes(1)
    const body = parse.mock.calls[0]![0] as Record<string, any>
    expect(body.model).toBe('claude-haiku-5-5')
    expect(gen.model).toBe('claude-haiku-5-5')
    expect(body.max_tokens).toBeGreaterThanOrEqual(4000)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.type).toBe('json_schema')
    const schema = JSON.stringify(body.output_config.format.schema)
    for (const field of ['input_side', 'not_a_word', 'example_target', 'example_source', 'alt_translations', 'perfect_3sg']) {
      expect(schema).toContain(field)
    }
    for (const forbidden of ['temperature', 'top_p', 'top_k', 'output_format']) expect(body).not.toHaveProperty(forbidden)

    // Prompt: languages, level, grammar hints from languages.ts, [[ ]] instructions; inputs in the user turn.
    expect(body.system).toContain('English speaker learning German')
    expect(body.system).toContain('5 to 10 words')
    expect(body.system).toContain('Präteritum')
    expect(body.system).toContain('[[word]]')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    const inputs = JSON.parse(body.messages[0].content.replace(/^Inputs:\n/, ''))
    expect(inputs).toEqual([
      { input: 'Hund', hint: null, input_language: 'target' },
      { input: 'big', hint: null, input_language: 'source' },
      { input: 'Bank', hint: 'bench', input_language: 'unknown' },
    ])
  })

  it('uses AI_MODEL when given and returns the parsed items', async () => {
    const { client } = mockClient(() => ok([ITEM]))
    const gen = new AnthropicGenerator({ client, model: 'claude-haiku-5-5' })
    expect(await gen.generate(REQ)).toEqual([ITEM])
  })

  it('maps errors: 429/5xx/connection are retryable, 400/401 are not; refusal, truncation and schema misses', async () => {
    const cases: [unknown, boolean, number | undefined][] = [
      [Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error' } }, 'rate', new Headers()), true, 429],
      [Anthropic.APIError.generate(529, { error: { type: 'overloaded_error' } }, 'overloaded', new Headers()), true, 529],
      [Anthropic.APIError.generate(500, undefined, 'oops', new Headers()), true, 500],
      [new Anthropic.APIConnectionError({ message: 'offline' }), true, undefined],
      [Anthropic.APIError.generate(400, { error: { type: 'invalid_request_error' } }, 'bad', new Headers()), false, 400],
      [Anthropic.APIError.generate(401, { error: { type: 'authentication_error' } }, 'auth', new Headers()), false, 401],
    ]
    for (const [err, retryable, status] of cases) {
      expect(toGeneratorError(err)).toMatchObject({ retryable, status })
      const { client } = mockClient(() => {
        throw err
      })
      await expect(new AnthropicGenerator({ client }).generate(REQ)).rejects.toMatchObject({ name: 'GeneratorError', retryable })
    }
    const refusal = mockClient(() => ({ stop_reason: 'refusal', parsed_output: null }))
    await expect(new AnthropicGenerator({ client: refusal.client }).generate(REQ)).rejects.toMatchObject({ retryable: false })
    const cut = mockClient(() => ({ stop_reason: 'max_tokens', parsed_output: null }))
    await expect(new AnthropicGenerator({ client: cut.client }).generate(REQ)).rejects.toMatchObject({ retryable: true })
    const empty = mockClient(() => ({ stop_reason: 'end_turn', parsed_output: null }))
    await expect(new AnthropicGenerator({ client: empty.client }).generate(REQ)).rejects.toThrow(/schema/)
  })

  it('response mapping through /generate: entry stored with model + prompt version, article fixed from gender, markers kept', async () => {
    const { client, parse } = mockClient(() =>
      ok([
        { ...ITEM, input: 'Hund' },
        // Matched by position although the model changed the echo; malformed markers are stripped.
        { ...ITEM, input: 'katze!', lemma: 'die Katze', translation: 'cat', alt_translations: ['cat', 'kitty', 'puss', 'pussycat', 'moggy'], grammar: { ...ITEM.grammar!, gender: 'feminine', article: null, plural: 'die Katzen' }, example_target: 'Die [[Katze schläft.', example_source: 'The [[cat]] sleeps.' },
      ]),
    )
    const ctx = setup({}, { generator: new AnthropicGenerator({ client }) })
    const deck = ((await (await ctx.as('alice@example.com', '/api/me')).json()) as MeResponse).decks[0]!.id
    await ctx.as('alice@example.com', `/api/decks/${deck}/import`, { method: 'POST', body: { text: 'Hund\nKatze', inputLang: 'target' } })
    const res = (await (await ctx.as('alice@example.com', `/api/decks/${deck}/generate`, { method: 'POST' })).json()) as GenerateResponse
    expect(res).toMatchObject({ processed: 2, generated: 2 })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(ctx.sqlite.prepare("SELECT model, prompt_version FROM entries WHERE lemma = 'Hund'").get()).toEqual({ model: 'claude-haiku-5-5', prompt_version: PROMPT_VERSION })
    const list = ((await (await ctx.as('alice@example.com', `/api/decks/${deck}/cards`)).json()) as CardListResponse).cards
    const hund = list.find((c: CardDTO) => c.inputTerm === 'Hund')!
    expect(hund.display).toBe('der Hund')
    expect(hund.content!.grammar).toMatchObject({ gender: 'masculine', article: 'der' })
    expect(hund.content!.exampleTarget).toBe('Der [[Hund]] bellt laut.')
    const katze = list.find((c: CardDTO) => c.inputTerm === 'Katze')!
    expect(katze).toMatchObject({ display: 'die Katze', translation: 'cat' })
    expect(katze.content).toMatchObject({ lemma: 'Katze', altTranslations: ['kitty', 'puss', 'pussycat'], exampleTarget: 'Die Katze schläft.', exampleSource: 'The [[cat]] sleeps.' })
  })
})

describe('createGenerator (AI_PROVIDER)', () => {
  const env = (over: Partial<Bindings>) => ({ AI_PROVIDER: 'fake', AI_MODEL: 'claude-haiku-5-5', ...over }) as Bindings
  it('fake -> FakeGenerator; anthropic with a key -> AnthropicGenerator; anthropic without a key -> fake', () => {
    expect(createGenerator(env({}))).toBeInstanceOf(FakeGenerator)
    expect(createGenerator(env({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }))).toBeInstanceOf(AnthropicGenerator)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createGenerator(env({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' }))).toBeInstanceOf(FakeGenerator)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
