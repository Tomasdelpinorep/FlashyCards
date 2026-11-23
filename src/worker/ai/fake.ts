/**
 * Deterministic offline generator (AI_PROVIDER=fake, tests, and the no-key fallback).
 *
 * Words are looked up in a small lexicon keyed by `<side>:<termKey>` or
 * `<side>:<termKey>|<hintKey>` (a meaning hint selects a sense), so different inputs can reach
 * the same lemma: dog -> Hund, big/large -> groß, ging -> gehen. For en -> de, words not in that
 * lexicon are then looked up in the curated dictionary (curated.de.ts, the same entries
 * migrations/0003_seed_de.sql seeds), so local runs show real-looking cards. Unknown words get a
 * generic entry built from the input; junk ("asdf", digits, "xxxx") is `not_a_word`.
 *
 * Tests can extend the lexicon, mark extra words as junk, queue errors, and hold a call open
 * with `gate` to interleave parallel requests. Every call is recorded in `calls`.
 */
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import { glossKey, termKey } from '../../shared/normalize'
import type { GenerationInput, GenerationRequest, SentenceGenerator, SuggestedWord, SuggestWordsRequest } from './generator'
import type { Gender, GeneratedItem, Grammar, VerbTable } from './schema'
import { CURATED_DE, type CuratedEntry as DevEntry } from './curated.de'

type Six = [string, string, string, string, string, string]

export type FakeWord = {
  lemma: string
  pos: NonNullable<GeneratedItem['pos']>
  translation: string
  alts?: string[]
  gender?: Gender
  plural?: string
  verb?: {
    present: string
    past: string
    perfect: string
    participle: string
    auxiliary: string
    /** Full tables, 6 persons (ich, du, er, wir, ihr, sie); absent -> null tables. */
    presentTable?: Six
    pastTable?: Six
  }
  comparative?: string
  superlative?: string
  cefr?: GeneratedItem['cefr']
  example?: [target: string, source: string]
}

const hund: FakeWord = { lemma: 'Hund', pos: 'noun', translation: 'dog', alts: ['hound'], gender: 'masculine', plural: 'die Hunde', cefr: 'A1', example: ['Der [[Hund]] spielt im Garten.', 'The [[dog]] is playing in the garden.'] }
const katze: FakeWord = { lemma: 'Katze', pos: 'noun', translation: 'cat', gender: 'feminine', plural: 'die Katzen', cefr: 'A1', example: ['Die [[Katze]] schläft auf dem Sofa.', 'The [[cat]] is sleeping on the sofa.'] }
const haus: FakeWord = { lemma: 'Haus', pos: 'noun', translation: 'house', alts: ['home', 'building'], gender: 'neuter', plural: 'die Häuser', cefr: 'A1', example: ['Unser [[Haus]] ist sehr alt.', 'Our [[house]] is very old.'] }
const wasser: FakeWord = { lemma: 'Wasser', pos: 'noun', translation: 'water', gender: 'neuter', cefr: 'A1', example: ['Ich trinke jeden Tag viel [[Wasser]].', 'I drink a lot of [[water]] every day.'] }
const gehen: FakeWord = {
  lemma: 'gehen',
  pos: 'verb',
  translation: 'to go',
  alts: ['to walk'],
  verb: {
    present: 'geht',
    past: 'ging',
    perfect: 'ist gegangen',
    participle: 'gegangen',
    auxiliary: 'sein',
    presentTable: ['gehe', 'gehst', 'geht', 'gehen', 'geht', 'gehen'],
    pastTable: ['ging', 'gingst', 'ging', 'gingen', 'gingt', 'gingen'],
  },
  cefr: 'A1',
  example: ['Wir [[gehen]] heute ins Kino.', 'We are [[going]] to the cinema today.'],
}
const essen: FakeWord = {
  lemma: 'essen',
  pos: 'verb',
  translation: 'to eat',
  verb: {
    present: 'isst',
    past: 'aß',
    perfect: 'hat gegessen',
    participle: 'gegessen',
    auxiliary: 'haben',
    presentTable: ['esse', 'isst', 'isst', 'essen', 'esst', 'essen'],
    pastTable: ['aß', 'aßt', 'aß', 'aßen', 'aßt', 'aßen'],
  },
  cefr: 'A1',
  example: ['Wir [[essen]] um sieben Uhr zu Abend.', 'We [[eat]] dinner at seven o’clock.'],
}
const gross: FakeWord = {
  lemma: 'groß',
  pos: 'adjective',
  translation: 'big',
  alts: ['large', 'tall'],
  comparative: 'größer',
  superlative: 'am größten',
  cefr: 'A1',
  example: ['Das Zimmer ist sehr [[groß]].', 'The room is very [[big]].'],
}
const bank: FakeWord = { lemma: 'Bank', pos: 'noun', translation: 'bank', gender: 'feminine', plural: 'die Banken', cefr: 'A1', example: ['Die [[Bank]] öffnet um neun Uhr.', 'The [[bank]] opens at nine.'] }
const bankBench: FakeWord = { lemma: 'Bank', pos: 'noun', translation: 'bench', gender: 'feminine', plural: 'die Bänke', cefr: 'A2', example: ['Wir sitzen auf der [[Bank]] im Park.', 'We are sitting on the [[bench]] in the park.'] }

/** Default lexicon for an en -> de deck. */
export const DEFAULT_LEXICON: Readonly<Record<string, FakeWord>> = {
  'target:hund': hund,
  'target:katze': katze,
  'target:haus': haus,
  'target:wasser': wasser,
  'target:gehen': gehen,
  'target:ging': gehen,
  'target:geht': gehen,
  'target:essen': essen,
  'target:groß': gross,
  'target:bank': bank,
  'target:bank|bench': bankBench,
  'target:bank|bank': bank,
  'source:dog': hund,
  // A synonym that is not one of Hund's glosses: importing it adds "pooch" as a translation (e2e).
  'source:pooch': hund,
  'source:cat': katze,
  'source:house': haus,
  'source:water': wasser,
  'source:to go': gehen,
  'source:go': gehen,
  'source:to eat': essen,
  'source:eat': essen,
  'source:big': gross,
  'source:large': gross,
  'source:bench': bankBench,
}

const perro: FakeWord = { lemma: 'perro', pos: 'noun', translation: 'dog', gender: 'masculine', plural: 'los perros', cefr: 'A1', example: ['El [[perro]] juega en el jardín.', 'The [[dog]] is playing in the garden.'] }
const gato: FakeWord = { lemma: 'gato', pos: 'noun', translation: 'cat', gender: 'masculine', plural: 'los gatos', cefr: 'A1', example: ['El [[gato]] duerme en el sofá.', 'The [[cat]] is sleeping on the sofa.'] }
const casa: FakeWord = { lemma: 'casa', pos: 'noun', translation: 'house', alts: ['home'], gender: 'feminine', plural: 'las casas', cefr: 'A1', example: ['Nuestra [[casa]] es muy vieja.', 'Our [[house]] is very old.'] }
const comer: FakeWord = {
  lemma: 'comer',
  pos: 'verb',
  translation: 'to eat',
  verb: {
    present: 'come',
    past: 'comió',
    perfect: 'ha comido',
    participle: 'comido',
    auxiliary: 'haber',
    presentTable: ['como', 'comes', 'come', 'comemos', 'coméis', 'comen'],
    pastTable: ['comí', 'comiste', 'comió', 'comimos', 'comisteis', 'comieron'],
  },
  cefr: 'A1',
  example: ['Nosotros [[comemos]] a las siete.', 'We [[eat]] at seven.'],
}

/** Lexicon for an en -> es deck. */
export const ES_LEXICON: Readonly<Record<string, FakeWord>> = {
  'target:perro': perro,
  'target:gato': gato,
  'target:casa': casa,
  'target:comer': comer,
  'source:dog': perro,
  'source:cat': gato,
  'source:house': casa,
  'source:to eat': comer,
  'source:eat': comer,
}

/** The built-in lexicon per target language (others get generic entries only). */
const LEXICONS: Partial<Record<LanguageCode, Readonly<Record<string, FakeWord>>>> = { de: DEFAULT_LEXICON, es: ES_LEXICON }

/** "The word [[x]] is new." in each language, for generic entries. */
const GENERIC_SENTENCE: Record<LanguageCode, (w: string) => string> = {
  de: (w) => `Das Wort [[${w}]] ist neu.`,
  en: (w) => `The word [[${w}]] is new.`,
  es: (w) => `La palabra [[${w}]] es nueva.`,
}

export const FAKE_MODEL = 'fake'

export type FakeGeneratorOptions = {
  /** Entries added to (or overriding) the target language's built-in lexicon (DEFAULT_LEXICON for de). */
  lexicon?: Record<string, FakeWord>
  /** Inputs (any side, compared lowercased) to report as not_a_word. */
  notAWords?: string[]
  /** Awaited before each call returns: lets a test hold a call open. */
  gate?: (request: GenerationRequest, callIndex: number) => Promise<void>
  /** Words suggestWords() draws from, in order (default: the lexicon's lemmas, then fakewordaa...). */
  suggestPool?: SuggestedWord[]
  /** Return pool words even when they are in `exclude` (to test the server-side filter). */
  suggestIgnoresExclude?: boolean
}

export class FakeGenerator implements SentenceGenerator {
  readonly model = FAKE_MODEL
  readonly calls: GenerationRequest[] = []
  readonly suggestCalls: SuggestWordsRequest[] = []
  private readonly suggestPool: SuggestedWord[] | undefined
  private readonly suggestIgnoresExclude: boolean
  private readonly extraLexicon: Record<string, FakeWord>
  private readonly notAWords: Set<string>
  private readonly errors: Error[] = []
  gate: FakeGeneratorOptions['gate']

  constructor(options: FakeGeneratorOptions = {}) {
    this.extraLexicon = { ...options.lexicon }
    this.notAWords = new Set((options.notAWords ?? []).map((w) => w.toLowerCase()))
    this.gate = options.gate
    this.suggestPool = options.suggestPool
    this.suggestIgnoresExclude = options.suggestIgnoresExclude ?? false
  }

  /** Deterministic: the first `count` pool words not in `exclude` (a well-behaved model). */
  async suggestWords(request: SuggestWordsRequest): Promise<SuggestedWord[]> {
    this.suggestCalls.push(request)
    await Promise.resolve()
    const err = this.errors.shift()
    if (err) throw err
    const exclude = new Set(request.exclude)
    return (this.suggestPool ?? defaultSuggestPool(this.lexiconFor(request.targetLang)))
      .filter((w) => this.suggestIgnoresExclude || !exclude.has(termKey(request.targetLang, w.lemma)))
      .slice(0, request.count)
  }

  /** The next call throws `err` (queue several to fail several calls). */
  failNext(err: Error): this {
    this.errors.push(err)
    return this
  }

  async generate(request: GenerationRequest): Promise<GeneratedItem[]> {
    const index = this.calls.length
    this.calls.push(request)
    await Promise.resolve() // always async, like a network call
    if (this.gate) await this.gate(request, index)
    const err = this.errors.shift()
    if (err) throw err
    return request.items.map((it) => this.item(request, it))
  }

  private lexiconFor(targetLang: LanguageCode): Record<string, FakeWord> {
    return { ...LEXICONS[targetLang], ...this.extraLexicon }
  }

  private item(req: GenerationRequest, it: GenerationInput): GeneratedItem {
    const lexicon = this.lexiconFor(req.targetLang)
    const sides: ('target' | 'source')[] = it.inputLang === 'auto' ? ['target', 'source'] : [it.inputLang]
    const hintKey = it.hint ? glossKey(req.sourceLang, it.hint) : ''
    for (const side of sides) {
      const key = termKey(side === 'target' ? req.targetLang : req.sourceLang, it.input)
      const word = (hintKey && lexicon[`${side}:${key}|${hintKey}`]) || lexicon[`${side}:${key}`]
      if (word) return toItem(req.targetLang, it.input, side, word)
      const dev = devLexiconFor(req.targetLang, req.sourceLang)?.get(`${side}:${key}`)
      if (dev) return { input: it.input, input_side: side, status: 'ok', ...dev }
    }
    const side = sides[0]!
    if (isJunk(it.input) || this.notAWords.has(it.input.trim().toLowerCase())) return notAWord(it.input, side)
    return toItem(req.targetLang, it.input, side, genericWord(req, it, side))
  }
}

/**
 * Curated entries (curated.de.ts) keyed like the lexicon: `target:<lemma key>` (also
 * without a leading "sich ") and `source:<key>` for the translation and alternatives, with and
 * without "to"/"a"/"the" (first entry wins). Consulted after the built-in/test lexicon, so tests
 * keep their outputs. Built once, on first use.
 */
let devIndexDe: Map<string, DevEntry> | undefined
function devLexiconFor(targetLang: LanguageCode, sourceLang: LanguageCode): Map<string, DevEntry> | undefined {
  if (targetLang !== 'de' || sourceLang !== 'en') return undefined
  if (devIndexDe) return devIndexDe
  const index = new Map<string, DevEntry>()
  const add = (key: string, e: DevEntry) => {
    if (!key.endsWith(':') && !index.has(key)) index.set(key, e)
  }
  for (const e of CURATED_DE) {
    const lemma = e.lemma!
    add(`target:${termKey('de', lemma)}`, e)
    if (lemma.startsWith('sich ')) add(`target:${termKey('de', lemma.slice(5))}`, e)
  }
  for (const e of CURATED_DE) {
    for (const gloss of [e.translation!, ...e.alt_translations]) {
      add(`source:${termKey('en', gloss)}`, e)
      add(`source:${glossKey('en', gloss)}`, e)
    }
  }
  devIndexDe = index
  return index
}

function defaultSuggestPool(lexicon: Record<string, FakeWord>): SuggestedWord[] {
  const seen = new Set<string>()
  const out: SuggestedWord[] = []
  for (const [key, w] of Object.entries(lexicon)) {
    if (!key.startsWith('target:') || key.includes('|') || seen.has(w.lemma)) continue
    seen.add(w.lemma)
    out.push({ lemma: w.lemma, pos: w.pos })
  }
  // Letters only: inputs with digits are "junk" for the fake generator (isJunk).
  const letters = (n: number) => String.fromCharCode(97 + Math.floor(n / 26) % 26, 97 + (n % 26))
  for (let i = 0; i < 500; i++) out.push({ lemma: `fakeword${letters(i)}`, pos: 'noun' })
  return out
}

function isJunk(input: string): boolean {
  const s = input.trim().toLowerCase()
  return /\d/.test(s) || /(.)\1\1/u.test(s) || /^(asdf|qwer|xyz)/.test(s) || !/\p{L}/u.test(s)
}

/** A plausible entry for a word the lexicon does not know (deterministic). */
function genericWord(req: GenerationRequest, it: GenerationInput, side: 'target' | 'source'): FakeWord {
  const word = it.input.trim()
  const t = GENERIC_SENTENCE[req.targetLang]
  const s = GENERIC_SENTENCE[req.sourceLang]
  if (side === 'target') {
    const translation = it.hint?.trim() || `${word} (meaning)`
    return { lemma: word, pos: 'other', translation, example: [t(word), s(translation)] }
  }
  const lemma = `${word} (${req.targetLang})`
  return { lemma, pos: 'other', translation: word, example: [t(lemma), s(word)] }
}

function notAWord(input: string, side: 'target' | 'source'): GeneratedItem {
  return {
    input,
    input_side: side,
    status: 'not_a_word',
    lemma: null,
    pos: null,
    translation: null,
    alt_translations: [],
    cefr: null,
    grammar: null,
    example_target: null,
    example_source: null,
  }
}

function table(t: Six | undefined): VerbTable | null {
  return t ? { p1s: t[0], p2s: t[1], p3s: t[2], p1p: t[3], p2p: t[4], p3p: t[5] } : null
}

function toItem(targetLang: LanguageCode, input: string, side: 'target' | 'source', w: FakeWord): GeneratedItem {
  const article = w.gender ? (LANGUAGES[targetLang].genderArticles?.[w.gender] ?? null) : null
  const grammar: Grammar = {
    gender: w.gender ?? null,
    article,
    plural: w.plural ?? null,
    genitive: null,
    verb: w.verb
      ? {
          present: table(w.verb.presentTable),
          past: table(w.verb.pastTable),
          present_3sg: w.verb.present,
          past_3sg: w.verb.past,
          perfect_3sg: w.verb.perfect,
          participle: w.verb.participle,
          auxiliary: w.verb.auxiliary,
          separable: false,
          reflexive: false,
        }
      : null,
    governs_case: null,
    comparative: w.comparative ?? null,
    superlative: w.superlative ?? null,
    note: null,
  }
  const [exampleTarget, exampleSource] = w.example ?? [`[[${w.lemma}]].`, `[[${w.translation}]].`]
  return {
    input,
    input_side: side,
    status: 'ok',
    lemma: w.lemma,
    pos: w.pos,
    translation: w.translation,
    alt_translations: w.alts ?? [],
    cefr: w.cefr ?? null,
    grammar,
    example_target: exampleTarget,
    example_source: exampleSource,
  }
}
