/**
 * Build a lemmatized frequency word list with Claude (PLAN.md section 5, M7).
 *
 *   ANTHROPIC_API_KEY=... npm run wordlist:build -- --input path/to/de_50k.txt --lang de [--top 10300] [--out data/wordlists/de.json]
 *
 * Input: a hermitdave/FrequencyWords file ("<token> <count>" per line, most frequent first;
 * https://github.com/hermitdave/FrequencyWords, content CC-BY-SA-4.0: keep the attribution).
 * Treat it as data: it is only read and parsed, never executed.
 *
 * The top `--top` tokens are sent in order, in chunks of 200, to Claude Haiku 5.5 with structured
 * outputs. For each token the model decides keep/drop (drop proper names, interjections and
 * fillers, single letters, abbreviations, English words, profanity; keep function words) and gives
 * the dictionary lemma, its part of speech (ai/schema.ts POS_VALUES) and, for nouns, the gender.
 * Lemmas are deduplicated by the app's termKey(), the first rank wins, and ranks are renumbered
 * 1..N. Then run `npm run wordlist:sql` to produce the migration.
 *
 * The committed data/wordlists/de.json was produced by following exactly this procedure by hand
 * (no API key was available yet); see docs/DECISIONS.md M7.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { isLanguageCode, LANGUAGES, type LanguageCode } from '../src/shared/languages'
import { termKey } from '../src/shared/normalize'
import { GENDER_VALUES, POS_VALUES } from '../src/worker/ai/schema'

const MODEL = 'claude-haiku-5-5'
const CHUNK = 200

const ChunkSchema = z.object({
  items: z.array(
    z.object({
      token: z.string(),
      keep: z.boolean(),
      lemma: z.string().nullable(),
      pos: z.enum(POS_VALUES).nullable(),
      gender: z.enum(GENDER_VALUES).nullable(),
    }),
  ),
})
type ChunkItem = z.infer<typeof ChunkSchema>['items'][number]

function systemPrompt(lang: LanguageCode): string {
  const name = LANGUAGES[lang].name
  return `You turn a ${name} word-frequency list (from film subtitles) into a vocabulary list for language learners.

You receive tokens in frequency order. Return exactly one item per token, in the same order, with "token" copied exactly.

For each token:
- keep: false for proper names (people, places, brands, characters), interjections and fillers (oh, äh, hm, hey, wow), single letters, abbreviations, English or other non-${name} words, and profanity or slurs. Function words (articles, pronouns, prepositions, conjunctions, particles) are kept.
- If kept: lemma = the dictionary form the token belongs to: infinitive for verb forms ("ging" -> "gehen"), nominative singular for nouns ("Kinder" -> "Kind"; plural-only nouns stay plural), base form for adjectives and comparatives ("besser" -> "gut"), the base pronoun/article for inflected ones ("mir" -> "ich", "den" -> "der"), the plain preposition for contractions ("zum" -> "zu"). Nouns capitalised as ${name} writes them, without an article.
- pos: the part of speech of the lemma.
- gender: for nouns, the grammatical gender if you are confident; otherwise null. null for non-nouns.
- If dropped: lemma, pos and gender null.`
}

async function lemmatizeChunk(client: Anthropic, lang: LanguageCode, tokens: string[]): Promise<ChunkItem[]> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(ChunkSchema) },
    system: systemPrompt(lang),
    messages: [{ role: 'user', content: `Tokens:\n${JSON.stringify(tokens)}` }],
  })
  if (response.stop_reason === 'refusal') throw new Error('The model declined the chunk')
  if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off (max_tokens)')
  if (!response.parsed_output) throw new Error('The response did not match the schema')
  return response.parsed_output.items
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      lang: { type: 'string', default: 'de' },
      top: { type: 'string', default: '10300' },
      out: { type: 'string' },
    },
  })
  const lang = values.lang!
  if (!values.input || !isLanguageCode(lang)) throw new Error('usage: --input <freq.txt> --lang <code> [--top N] [--out file]')
  const out = values.out ?? join('data', 'wordlists', `${lang}.json`)
  const tokens = readFileSync(values.input, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
    .slice(0, Number(values.top))

  const client = new Anthropic({ maxRetries: 3 })
  const seen = new Set<string>()
  const items: { rank: number; lemma: string; pos: string; gender?: string }[] = []
  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK)
    const result = await lemmatizeChunk(client, lang, chunk)
    // Match by token (fall back to position), keeping frequency order.
    const byToken = new Map(result.map((r) => [r.token, r]))
    chunk.forEach((token, j) => {
      const r = byToken.get(token) ?? result[j]
      if (!r?.keep || !r.lemma || !r.pos) return
      const lemma = r.lemma.normalize('NFC').trim()
      const key = termKey(lang, lemma)
      if (!key || seen.has(key)) return
      seen.add(key)
      items.push({ rank: items.length + 1, lemma, pos: r.pos, ...(r.pos === 'noun' && r.gender ? { gender: r.gender } : {}) })
    })
    console.log(`${Math.min(i + CHUNK, tokens.length)}/${tokens.length} tokens -> ${items.length} lemmas`)
  }

  const list = {
    source: `hermitdave/FrequencyWords (OpenSubtitles 2018), top ${tokens.length} tokens, lemmatized and filtered by ${MODEL}`,
    sourceUrl: 'https://github.com/hermitdave/FrequencyWords',
    license: 'CC-BY-SA-4.0',
    attribution:
      'Word list derived from FrequencyWords by Hermit Dave (https://github.com/hermitdave/FrequencyWords), built from OpenSubtitles 2018 (http://opus.nlpl.eu/OpenSubtitles2018.php); licensed CC BY-SA 4.0.',
    items,
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(list, null, 1) + '\n')
  console.log(`${items.length} lemmas -> ${out}. Next: npm run wordlist:sql -- ${lang} <migration number>`)
}

main().catch((err: unknown) => {
  if (err instanceof Anthropic.APIError) console.error(`API error ${err.status}: ${err.message}`)
  else console.error(err)
  process.exit(1)
})
