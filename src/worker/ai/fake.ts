/**
 * Deterministic offline generator (AI_PROVIDER=fake, tests, and the no-key fallback).
 *
 * Words are looked up in a small lexicon keyed by `<side>:<termKey>` or
 * `<side>:<termKey>|<hintKey>` (a meaning hint selects a sense), so different inputs can reach
 * the same lemma: dog -> Hund, big/large -> groß, ging -> gehen. Unknown words get a generic
 * entry built from the input; junk ("asdf", digits, "xxxx") is `not_a_word`.
 *
 * Tests can extend the lexicon, mark extra words as junk, queue errors, and hold a call open
 * with `gate` to interleave parallel requests. Every call is recorded in `calls`.
 */
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import { glossKey, termKey } from '../../shared/normalize'
import type { GenerationInput, GenerationRequest, SentenceGenerator } from './generator'
import type { Gender, GeneratedItem, Grammar } from './schema'

export type FakeWord = {
  lemma: string
  pos: NonNullable<GeneratedItem['pos']>
  translation: string
  alts?: string[]
  gender?: Gender
  plural?: string
  verb?: { present: string; past: string; perfect: string; participle: string; auxiliary: string }
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
  verb: { present: 'geht', past: 'ging', perfect: 'ist gegangen', participle: 'gegangen', auxiliary: 'sein' },
  cefr: 'A1',
  example: ['Wir [[gehen]] heute ins Kino.', 'We are [[going]] to the cinema today.'],
}
const essen: FakeWord = {
  lemma: 'essen',
  pos: 'verb',
  translation: 'to eat',
  verb: { present: 'isst', past: 'aß', perfect: 'hat gegessen', participle: 'gegessen', auxiliary: 'haben' },
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

export const FAKE_MODEL = 'fake'

export type FakeGeneratorOptions = {
  /** Entries added to (or overriding) DEFAULT_LEXICON. */
  lexicon?: Record<string, FakeWord>
  /** Inputs (any side, compared lowercased) to report as not_a_word. */
  notAWords?: string[]
  /** Awaited before each call returns: lets a test hold a call open. */
  gate?: (request: GenerationRequest, callIndex: number) => Promise<void>
}

export class FakeGenerator implements SentenceGenerator {
  readonly model = FAKE_MODEL
  readonly calls: GenerationRequest[] = []
  private readonly lexicon: Record<string, FakeWord>
  private readonly notAWords: Set<string>
  private readonly errors: Error[] = []
  gate: FakeGeneratorOptions['gate']

  constructor(options: FakeGeneratorOptions = {}) {
    this.lexicon = { ...DEFAULT_LEXICON, ...options.lexicon }
    this.notAWords = new Set((options.notAWords ?? []).map((w) => w.toLowerCase()))
    this.gate = options.gate
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

  private item(req: GenerationRequest, it: GenerationInput): GeneratedItem {
    const sides: ('target' | 'source')[] = it.inputLang === 'auto' ? ['target', 'source'] : [it.inputLang]
    const hintKey = it.hint ? glossKey(req.sourceLang, it.hint) : ''
    for (const side of sides) {
      const key = termKey(side === 'target' ? req.targetLang : req.sourceLang, it.input)
      const word = (hintKey && this.lexicon[`${side}:${key}|${hintKey}`]) || this.lexicon[`${side}:${key}`]
      if (word) return toItem(req.targetLang, it.input, side, word)
    }
    const side = sides[0]!
    if (isJunk(it.input) || this.notAWords.has(it.input.trim().toLowerCase())) return notAWord(it.input, side)
    return toItem(req.targetLang, it.input, side, genericWord(it, side))
  }
}

function isJunk(input: string): boolean {
  const s = input.trim().toLowerCase()
  return /\d/.test(s) || /(.)\1\1/u.test(s) || /^(asdf|qwer|xyz)/.test(s) || !/\p{L}/u.test(s)
}

/** A plausible entry for a word the lexicon does not know (deterministic). */
function genericWord(it: GenerationInput, side: 'target' | 'source'): FakeWord {
  const word = it.input.trim()
  if (side === 'target') {
    const translation = it.hint?.trim() || `${word} (meaning)`
    return { lemma: word, pos: 'other', translation, example: [`Das Wort [[${word}]] ist neu.`, `The word [[${translation}]] is new.`] }
  }
  const lemma = `${word} (de)`
  return {
    lemma,
    pos: 'other',
    translation: word,
    example: [`Das Wort [[${lemma}]] ist neu.`, `The word [[${word}]] is new.`],
  }
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

function toItem(targetLang: LanguageCode, input: string, side: 'target' | 'source', w: FakeWord): GeneratedItem {
  const article = w.gender ? (LANGUAGES[targetLang].genderArticles?.[w.gender] ?? null) : null
  const grammar: Grammar = {
    gender: w.gender ?? null,
    article,
    plural: w.plural ?? null,
    genitive: null,
    verb: w.verb
      ? {
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
