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
  /** BCP 47 tag for speechSynthesis; also the speech-recognition language for spoken answers. */
  ttsLang: string
  /** The six persons of a verb table: 1st/2nd/3rd singular, then 1st/2nd/3rd plural. */
  personLabels: readonly [string, string, string, string, string, string]
  /**
   * Character folds applied to BOTH sides when checking a typed answer (src/shared/answerCheck.ts),
   * so "muede" matches "müde" and "arbol" matches "árbol".
   */
  answerFolds: readonly (readonly [from: string, to: string])[]
  /** Whether a typed noun in this language must include its article ("der Hund", not "Hund"). */
  requireArticleForNouns: boolean
  /** Lowercase prefixes ignored on both sides of a typed answer in this language ("to go" = "go"). */
  answerStripPrefixes: readonly string[]
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
  /** Word-list lemmas "Add new words" never suggests (pronouns, articles, ... a learner gets for free). */
  suggestSkipLemmas?: readonly string[]
  /**
   * "Add new words" suggests only lemmas the curated dictionary has (model 'curated' entries for
   * the deck's pair), so every suggestion is ready at once. A pair without curated entries falls
   * back to the whole word list.
   */
  suggestCuratedOnly?: boolean
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
    personLabels: ['I', 'you', 'he/she', 'we', 'you', 'they'],
    answerFolds: [],
    requireArticleForNouns: false,
    answerStripPrefixes: ['to ', 'a ', 'an ', 'the '],
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
    personLabels: ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'],
    answerFolds: [
      ['ä', 'ae'],
      ['ö', 'oe'],
      ['ü', 'ue'],
      ['ß', 'ss'],
    ],
    requireArticleForNouns: true,
    // The reflexive pronoun is optional in answers: "anmelden" = "sich anmelden".
    answerStripPrefixes: ['sich '],
    articles: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
    glossStripPrefixes: ['der ', 'die ', 'das ', 'ein ', 'eine '],
    importHeaderWords: ['deutsch', 'german', 'wort', 'wörter', 'begriff', 'übersetzung', 'bedeutung', 'vokabel', 'vokabeln'],
    importExample: 'der Hund\nKatze;cat\ngehen',
    genderColors: { der: 'blue', die: 'red', das: 'green' },
    genderArticles: { masculine: 'der', feminine: 'die', neuter: 'das' },
    grammarPromptHints: [
      'Nouns: gender; article (der/die/das); plural with its article ("die Hunde"), null if the noun has no plural; genitive only if irregular ("des Namens"). Nouns are capitalised.',
      'Verbs: verb.present is the full Präsens table (p1s ich, p2s du, p3s er/sie/es, p1p wir, p2p ihr, p3p sie/Sie), the verb form only, without the pronoun ("gehe", "gehst", "geht", "gehen", "geht", "gehen"); separable verbs with the particle at the end ("stehe auf"); reflexive verbs with the pronoun ("freue mich"). verb.past is the same table in the Präteritum ("ging", "gingst", ...). Also verb.present_3sg ("geht"), verb.past_3sg (Präteritum, "ging"), verb.perfect_3sg ("ist gegangen"), verb.participle ("gegangen"), verb.auxiliary ("haben" or "sein"), verb.separable, verb.reflexive (reflexive lemmas look like "sich freuen"); governs_case when the object is dative or genitive.',
      'Adjectives: comparative and superlative only if irregular ("größer", "am größten").',
      'Prepositions: governs_case ("accusative", "dative", "genitive", or "accusative/dative" for two-way prepositions).',
      'Separable verbs in example_target: wrap both parts, e.g. "Ich [[stehe]] um sieben Uhr [[auf]]."',
    ].join('\n'),
    hasWordlist: true, // migrations/0002_wordlist_de.sql, from data/wordlists/de.json
    suggestSkipLemmas: ['ich', 'sie', 'der', 'du', 'es', 'wir', 'er', 'ein', 'ja', 'ihr', 'nein', 'sich', 'man'],
    suggestCuratedOnly: true, // migrations/0003_seed_de.sql
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
    personLabels: ['yo', 'tú', 'él/ella', 'nosotros', 'vosotros', 'ellos/ustedes'],
    answerFolds: [
      ['á', 'a'],
      ['é', 'e'],
      ['í', 'i'],
      ['ó', 'o'],
      ['ú', 'u'],
      ['ñ', 'n'],
      ['ü', 'u'],
    ],
    requireArticleForNouns: true,
    answerStripPrefixes: [],
    articles: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas'],
    glossStripPrefixes: ['el ', 'la ', 'los ', 'las ', 'un ', 'una '],
    importHeaderWords: ['español', 'spanish', 'palabra', 'palabras', 'término', 'traducción', 'significado'],
    importExample: 'el perro\ngato;cat\ncomer',
    genderColors: { el: 'blue', la: 'red' },
    genderArticles: { masculine: 'el', feminine: 'la' },
    grammarPromptHints: [
      'Nouns: gender; article (el/la); plural with its article ("los perros").',
      'Verbs: verb.present is the full presente table (p1s yo, p2s tú, p3s él/ella, p1p nosotros, p2p vosotros, p3p ellos/ustedes), the verb form only, without the pronoun ("como", "comes", "come", "comemos", "coméis", "comen"); reflexive verbs with the pronoun ("me levanto"). verb.past is the same table in the pretérito indefinido ("comí", "comiste", ...). Also verb.present_3sg, verb.past_3sg (pretérito indefinido), verb.perfect_3sg ("ha comido"), verb.participle, verb.reflexive; irregular stem changes in grammar.note.',
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
