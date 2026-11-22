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
  /**
   * Lowercase prefixes (with their trailing space) that glossKey() strips from a gloss in
   * this language, e.g. English "to begin" -> "begin" (docs/DUPLICATES.md section 10.1).
   */
  glossStripPrefixes: readonly string[]
  /** Lowercase column titles in this language that mark an import header row ("wort", "deutsch"). */
  importHeaderWords: readonly string[]
  /** Article -> colour token for gendered nouns (der blue, die red, das green). */
  genderColors?: Readonly<Record<string, 'blue' | 'red' | 'green'>>
  /**
   * Grammatical gender -> definite singular article. Used to check that an AI-generated
   * article agrees with the gender (post-validation). Absent for languages without gender.
   */
  genderArticles?: Readonly<Partial<Record<'masculine' | 'feminine' | 'neuter', string>>>
  /** How translations into this language are written, for the AI prompt when this is the source language. */
  glossStyleHint?: string
  /** Example lines for the import box placeholder when this is the target language. */
  importExample?: string
  /** Extra grammar instructions for the AI prompt when this is the target language. */
  grammarPromptHints: string
  /** Whether a bundled frequency word list exists (wordlist table). Without one, /suggest asks the AI. */
  hasWordlist: boolean
  /** Source and licence of the bundled word list, for the About screen (attribution required). */
  wordlist?: WordlistSource
}

export type WordlistSource = {
  /** Short credit line. */
  name: string
  url: string
  /** SPDX licence id. */
  license: string
  licenseUrl: string
  /** Full attribution text (also in data/wordlists/<code>.json). */
  attribution: string
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageConfig>> = {
  en: {
    code: 'en',
    name: 'English',
    ttsLang: 'en-US',
    articles: ['the', 'a', 'an'],
    glossStripPrefixes: ['to ', 'a ', 'an ', 'the '],
    importHeaderWords: ['english', 'word', 'words', 'term', 'terms', 'translation', 'meaning', 'hint', 'front', 'back'],
    grammarPromptHints:
      'Verbs: irregular past tense and past participle. Nouns: irregular plural. Adjectives: irregular comparative and superlative.',
    glossStyleHint: 'verbs as "to ..."',
    hasWordlist: false,
  },
  de: {
    code: 'de',
    name: 'German',
    ttsLang: 'de-DE',
    articles: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
    glossStripPrefixes: ['der ', 'die ', 'das ', 'ein ', 'eine '],
    importHeaderWords: ['deutsch', 'german', 'wort', 'wörter', 'begriff', 'übersetzung', 'bedeutung', 'vokabel', 'vokabeln'],
    importExample: 'der Hund\nKatze;cat\ngehen',
    genderColors: { der: 'blue', die: 'red', das: 'green' },
    genderArticles: { masculine: 'der', feminine: 'die', neuter: 'das' },
    grammarPromptHints: [
      'Nouns: gender; article (der/die/das); plural with its article ("die Hunde"), null if the noun has no plural; genitive only if irregular ("des Namens"). Nouns are capitalised.',
      'Verbs: verb.present_3sg ("geht"), verb.past_3sg (Präteritum, "ging"), verb.perfect_3sg ("ist gegangen"), verb.participle ("gegangen"), verb.auxiliary ("haben" or "sein"), verb.separable, verb.reflexive (reflexive lemmas look like "sich freuen"); governs_case when the object is dative or genitive.',
      'Adjectives: comparative and superlative only if irregular ("größer", "am größten").',
      'Prepositions: governs_case ("accusative", "dative", "genitive", or "accusative/dative" for two-way prepositions).',
      'Separable verbs in example_target: wrap both parts, e.g. "Ich [[stehe]] um sieben Uhr [[auf]]."',
    ].join('\n'),
    hasWordlist: true, // migrations/0002_wordlist_de.sql, from data/wordlists/de.json
    wordlist: {
      name: 'FrequencyWords by Hermit Dave (OpenSubtitles 2018)',
      url: 'https://github.com/hermitdave/FrequencyWords',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution:
        'German word list derived from FrequencyWords by Hermit Dave (https://github.com/hermitdave/FrequencyWords), built from OpenSubtitles 2018 (http://opus.nlpl.eu/OpenSubtitles2018.php); licensed CC BY-SA 4.0. Lemmatized and filtered for this app; the derived list is shared under the same license.',
    },
  },
  es: {
    code: 'es',
    name: 'Spanish',
    ttsLang: 'es-ES',
    articles: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas'],
    glossStripPrefixes: ['el ', 'la ', 'los ', 'las ', 'un ', 'una '],
    importHeaderWords: ['español', 'spanish', 'palabra', 'palabras', 'término', 'traducción', 'significado'],
    importExample: 'el perro\ngato;cat\ncomer',
    genderColors: { el: 'blue', la: 'red' },
    genderArticles: { masculine: 'el', feminine: 'la' },
    grammarPromptHints: [
      'Nouns: gender; article (el/la); plural with its article ("los perros").',
      'Verbs: verb.present_3sg, verb.past_3sg (pretérito indefinido), verb.perfect_3sg ("ha comido"), verb.participle, verb.reflexive; irregular stem changes in grammar.note.',
      'Adjectives: feminine form if irregular.',
    ].join('\n'),
    hasWordlist: false,
  },
}

/** The language pair a new user's first deck (and the new-deck form) starts with. */
export const DEFAULT_SOURCE: LanguageCode = 'en'
export const DEFAULT_TARGET: LanguageCode = 'de'

export function isLanguageCode(code: string): code is LanguageCode {
  return (LANGUAGE_CODES as readonly string[]).includes(code)
}

export function getLanguage(code: LanguageCode): LanguageConfig {
  return LANGUAGES[code]
}
