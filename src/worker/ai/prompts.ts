/**
 * Prompts for batched word generation (PLAN.md section 5). Language-specific guidance comes
 * only from `languages.ts` (grammarPromptHints); nothing here branches on a language.
 *
 * Bump PROMPT_VERSION whenever the prompt or the output schema changes meaningfully; it is
 * stored in entries.prompt_version so old cache rows can be found and refreshed later.
 */
import { LANGUAGES } from '../../shared/languages'
import type { SentenceLevel } from '../../shared/schemas'
import type { GenerationRequest, SuggestWordsRequest } from './generator'

// 2 (M7): optional per-input "pos" (the expected part of speech of a suggested word).
export const PROMPT_VERSION = 2

/** How the example sentence should read at each deck level (the user chose A1-A2 by default). */
export const LEVEL_GUIDANCE: Readonly<Record<SentenceLevel, string>> = {
  'A1-A2':
    'CEFR A1-A2: 5 to 10 words, simple and natural everyday sentences (home, food, family, work, shopping, weather, free time). Present tense or the most common past tense, high-frequency vocabulary only, no subordinate clauses.',
  'B1-B2':
    'CEFR B1-B2: 7 to 14 words, natural sentences on everyday and general topics. Common tenses and simple subordinate clauses are fine.',
  'C1-C2':
    'CEFR C1-C2: 8 to 18 words, natural and idiomatic sentences, any tense or structure a native speaker would use.',
}

export function systemPrompt(req: Pick<GenerationRequest, 'sourceLang' | 'targetLang' | 'level'>): string {
  const target = LANGUAGES[req.targetLang]
  const source = LANGUAGES[req.sourceLang]
  return `You write vocabulary flashcards for a ${source.name} speaker learning ${target.name}.
"Target" means ${target.name}; "source" means ${source.name}.

You receive a JSON list of inputs. Return exactly one item per input, in the same order, with "input" copied exactly as given.

For each input:
- input_side: "target" if the input is a ${target.name} word, "source" if it is a ${source.name} word. When input_language is given, use it; when it is "unknown", decide.
- If the input is not a real word or common phrase in that language (typos you cannot confidently fix, random letters, names of people), set status "not_a_word" and every other field to null (alt_translations: []).
- Otherwise status "ok", and:
  - lemma: the ${target.name} dictionary form, without an article. For ${source.name} input, pick the most common ${target.name} equivalent. For an inflected form (a conjugated verb, a plural noun), give the dictionary form.
  - pos: the part of speech of the lemma.
  - translation: the most common short ${source.name} translation of the lemma (1-3 words; verbs as "to ...").
  - alt_translations: up to 3 other common ${source.name} translations of the same meaning, most common first; [] if none.
  - cefr: the CEFR level of the word, or null if unsure.
  - expected_pos, when given, is the expected part of speech of the input: choose the reading of the word with that part of speech.
  - A hint, when given, is the meaning the learner wants (a ${source.name} gloss). Choose the lemma and translation for that meaning.
  - grammar: fill the fields that apply to this part of speech and use null for the rest and whenever you are unsure. ${target.name} specifics:
${indent(target.grammarPromptHints, '    ')}
  - example_target: ONE ${target.name} sentence that uses the word. ${LEVEL_GUIDANCE[req.level]} Wrap the exact form of the word as it appears in the sentence in double square brackets, e.g. [[word]].
  - example_source: a natural ${source.name} translation of that sentence, with the word that translates the lemma wrapped in [[ ]].

Sentences must sound like something a native speaker would actually say. Do not use quotation marks around the whole sentence.`
}

export function userPrompt(req: GenerationRequest): string {
  const inputs = req.items.map((it) => ({
    input: it.input,
    hint: it.hint,
    input_language: it.inputLang === 'auto' ? 'unknown' : it.inputLang,
    ...(it.pos ? { expected_pos: it.pos } : {}),
  }))
  return `Inputs:\n${JSON.stringify(inputs, null, 1)}`
}

/** AI fallback for /suggest: pick common target-language words the learner doesn't have yet. */
export function suggestSystemPrompt(req: Pick<SuggestWordsRequest, 'sourceLang' | 'targetLang' | 'level'>): string {
  const target = LANGUAGES[req.targetLang]
  const source = LANGUAGES[req.sourceLang]
  return `You choose vocabulary for a ${source.name} speaker learning ${target.name} (level ${req.level}).

Return the requested number of ${target.name} words that a learner should know, most frequent and most useful first, as in a frequency dictionary of everyday ${target.name}.
- Each word is one dictionary form (lemma): infinitive for verbs, singular for nouns, base form for adjectives. Nouns without an article, capitalised as ${target.name} writes them.
- Never return a word from the exclude list (it lists lowercased dictionary forms the learner already has), and never return the same word twice.
- Leave out names of people and places, brands, abbreviations, interjections and fillers, profanity, and words that are not ${target.name}.
- Function words (articles, pronouns, prepositions, conjunctions) are fine.
- pos: the part of speech of the lemma.`
}

export function suggestUserPrompt(req: Pick<SuggestWordsRequest, 'count' | 'exclude'>): string {
  return `Number of words: ${req.count}\nExclude:\n${JSON.stringify(req.exclude)}`
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n')
}
