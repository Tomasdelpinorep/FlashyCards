/** M7: the AnthropicGenerator side of the /suggest AI fallback and the POS hint in prompts. */
import { describe, expect, it, vi } from 'vitest'
import { AnthropicGenerator, type MessagesClient } from '../../src/worker/ai/anthropic'
import { GeneratorError } from '../../src/worker/ai/generator'
import { userPrompt } from '../../src/worker/ai/prompts'

function mockClient(impl: () => unknown) {
  const parse = vi.fn(async (_body: Record<string, unknown>) => impl())
  return { client: { messages: { parse } } as unknown as MessagesClient, parse }
}

const REQ = { sourceLang: 'en', targetLang: 'es', level: 'A1-A2', count: 12, exclude: ['perro', 'gato'] } as const

describe('AnthropicGenerator.suggestWords', () => {
  it('sends one structured-output request with the count and the exclusions', async () => {
    const { client, parse } = mockClient(() => ({ stop_reason: 'end_turn', parsed_output: { words: [{ lemma: 'casa', pos: 'noun' }] } }))
    const words = await new AnthropicGenerator({ client }).suggestWords({ ...REQ, exclude: [...REQ.exclude] })
    expect(words).toEqual([{ lemma: 'casa', pos: 'noun' }])
    const body = parse.mock.calls[0]![0]
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, output_config: { effort: 'low' } })
    expect(body).not.toHaveProperty('temperature')
    expect(String(body.system)).toContain('learning Spanish')
    expect(String((body.messages as { content: string }[])[0]!.content)).toContain('Number of words: 12')
    expect(String((body.messages as { content: string }[])[0]!.content)).toContain('["perro","gato"]')
  })

  it('maps refusals and schema misses to GeneratorError', async () => {
    const refusal = new AnthropicGenerator({ client: mockClient(() => ({ stop_reason: 'refusal', parsed_output: null })).client })
    await expect(refusal.suggestWords({ ...REQ, exclude: [] })).rejects.toMatchObject({ retryable: false })
    const miss = new AnthropicGenerator({ client: mockClient(() => ({ stop_reason: 'end_turn', parsed_output: null })).client })
    await expect(miss.suggestWords({ ...REQ, exclude: [] })).rejects.toBeInstanceOf(GeneratorError)
  })
})

describe('userPrompt POS hint', () => {
  it('adds expected_pos only to inputs that carry one', () => {
    const p = userPrompt({
      sourceLang: 'en',
      targetLang: 'de',
      level: 'A1-A2',
      items: [
        { input: 'sein', hint: null, inputLang: 'target', pos: 'verb' },
        { input: 'Hund', hint: null, inputLang: 'target' },
      ],
    })
    const inputs = JSON.parse(p.replace(/^Inputs:\n/, '')) as Record<string, unknown>[]
    expect(inputs[0]).toEqual({ input: 'sein', hint: null, input_language: 'target', expected_pos: 'verb' })
    expect(inputs[1]).toEqual({ input: 'Hund', hint: null, input_language: 'target' })
  })
})
