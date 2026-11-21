import type { Bindings } from '../env'
import { AnthropicGenerator } from './anthropic'
import { FakeGenerator } from './fake'
import type { SentenceGenerator } from './generator'

/** Same rule as the dev auth bypass (middleware/auth.ts). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Picks the sentence generator, failing closed (docs/DECISIONS.md, M5 Part 0). Fake entries must
 * never reach the shared global cache in production, so the fake generator is used only when
 * asked for explicitly or on a local host:
 *
 * - `AI_PROVIDER=fake`                      -> FakeGenerator
 * - `AI_PROVIDER=anthropic` + key           -> AnthropicGenerator
 * - `AI_PROVIDER=anthropic`, no key         -> null (503 ai_not_configured)
 * - unset, key                              -> AnthropicGenerator
 * - unset, no key, localhost/127.0.0.1 host -> FakeGenerator (local development)
 * - unset, no key, any other host           -> null
 * - any other value                         -> null
 *
 * `null` means "AI is not configured": /generate answers 503 before touching any card.
 */
export function createGenerator(env: Bindings, requestUrl: string): SentenceGenerator | null {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase()
  const key = env.ANTHROPIC_API_KEY?.trim()
  const anthropic = () => new AnthropicGenerator({ apiKey: key!, model: env.AI_MODEL || undefined })

  if (provider === 'fake') return new FakeGenerator()
  if (provider === 'anthropic') {
    if (key) return anthropic()
    console.error('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set: AI generation is disabled')
    return null
  }
  if (provider === '') {
    if (key) return anthropic()
    if (isLocalHost(requestUrl)) return new FakeGenerator()
    console.error('AI_PROVIDER is not set and there is no ANTHROPIC_API_KEY: AI generation is disabled')
    return null
  }
  console.error(`Unknown AI_PROVIDER "${env.AI_PROVIDER}": AI generation is disabled`)
  return null
}

function isLocalHost(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}
