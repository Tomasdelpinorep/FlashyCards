/**
 * Language registry. All language-specific knowledge lives here (PLAN.md section 1);
 * nothing outside this file should branch on a language code.
 */

export const LANGUAGE_CODES = ['en', 'de', 'es'] as const
export type LanguageCode = (typeof LANGUAGE_CODES)[number]

export interface LanguageConfig {
  /** ISO 639-1 code. */
  code: LanguageCode
  /** English name, used in UI and AI prompts. */
  name: string
  /** BCP 47 tag for speechSynthesis. */
  ttsLang: string
  /** Definite/indefinite articles that may prefix a noun (lowercase). */
  articles: readonly string[]
  /** Article -> colour token for gendered nouns (der blue, die red, das green). */
  genderColors?: Readonly<Record<string, 'blue' | 'red' | 'green'>>
  /** Extra grammar instructions for the AI prompt when this is the target language. */
  grammarPromptHints: string
  /** Whether a bundled frequency word list exists (wordlist table). */
  hasWordlist: boolean
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageConfig>> = {
  en: {
    code: 'en',
    name: 'English',
    ttsLang: 'en-US',
    articles: ['the', 'a', 'an'],
    grammarPromptHints:
      'Verbs: irregular past tense and past participle. Nouns: irregular plural. Adjectives: irregular comparative and superlative.',
    hasWordlist: false,
  },
  de: {
    code: 'de',
    name: 'German',
    ttsLang: 'de-DE',
    articles: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
    genderColors: { der: 'blue', die: 'red', das: 'green' },
    grammarPromptHints: [
      'Nouns: gender, article, plural with its article, irregular genitive.',
      'Verbs: present 3rd person singular, Präteritum 3rd person singular, past participle, auxiliary (haben/sein), separable, reflexive, governed case.',
      'Adjectives: irregular comparative and superlative.',
      'Prepositions: governed case.',
    ].join('\n'),
    hasWordlist: false, // becomes true in M7 (migrations/0002_wordlist_de.sql)
  },
  es: {
    code: 'es',
    name: 'Spanish',
    ttsLang: 'es-ES',
    articles: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas'],
    genderColors: { el: 'blue', la: 'red' },
    grammarPromptHints: [
      'Nouns: gender, article, plural.',
      'Verbs: present 3rd person singular, preterite 3rd person singular, past participle, reflexive, irregular stem changes.',
      'Adjectives: feminine form if irregular.',
    ].join('\n'),
    hasWordlist: false,
  },
}

export function isLanguageCode(code: string): code is LanguageCode {
  return (LANGUAGE_CODES as readonly string[]).includes(code)
}

export function getLanguage(code: LanguageCode): LanguageConfig {
  return LANGUAGES[code]
}
