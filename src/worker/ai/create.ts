import type { Bindings } from '../env'
import { AnthropicGenerator } from './anthropic'
import { FakeGenerator } from './fake'
import type { SentenceGenerator } from './generator'

/**
 * AI_PROVIDER=anthropic with an ANTHROPIC_API_KEY -> AnthropicGenerator; anything else
 * (AI_PROVIDER=fake, or no key) -> FakeGenerator.
 */
export function createGenerator(env: Bindings): SentenceGenerator {
  const key = env.ANTHROPIC_API_KEY?.trim()
  if (env.AI_PROVIDER === 'anthropic' && key) return new AnthropicGenerator({ apiKey: key, model: env.AI_MODEL || undefined })
  if (env.AI_PROVIDER === 'anthropic') console.warn('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set: using the fake generator')
  return new FakeGenerator()
}
