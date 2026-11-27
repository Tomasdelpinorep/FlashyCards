/**
 * Typed / spoken answer checking for Train and the Learn quick check (docs/DECISIONS.md,
 * "Answer check"). Pure, no language branches: folds, article rules and ignored prefixes come
 * from languages.ts.
 *
 * - Forgiving: case, extra spaces, trailing punctuation, and the language's folds
 *   (ae = ä, ss = ß, a = á ...) on both sides; gloss prefixes ("to go" = "go").
 * - Phrases ("Es tut mir leid.", "Einen Moment, bitte."): punctuation and apostrophes anywhere
 *   are ignored, and the answer is not split on commas.
 * - Nouns in languages with requireArticleForNouns need the article: "Hund" -> missing-article,
 *   "die Hund" -> wrong-article (checked before the typo distance, so never "typo").
 * - live (while typing): only an exact normalized match is "correct", anything else "pending".
 * - final (Enter, blur, a pause, end of speech): one typo (Damerau distance 1) on a term of at
 *   least 5 letters (without the article) is "typo"; otherwise "wrong".
 */
import type { FaceDirection } from './display'
import { collapseWhitespace } from './normalize'
import { LANGUAGES, isLanguageCode, type LanguageCode, type UiLanguage } from './languages'
import type { Grade } from './srs'

export type Expected = {
  /** The answer shown when the learner gets it wrong ("der Hund", "dog"). */
  primary: string
  /** Other accepted answers (alt translations, the learner's extra translations). */
  alternatives: readonly string[]
  /** Whether the answer is a noun (the article rule applies in languages that require it). */
  isNoun: boolean
  /** The noun's article ("der"), if any. */
  article: string | null
  /** A set phrase: compared whole, ignoring punctuation (no "," / ";" split). */
  isPhrase?: boolean
}

export type Verdict = 'correct' | 'typo' | 'missing-article' | 'wrong-article' | 'wrong' | 'pending'

export type CheckResult = {
  verdict: Verdict
  /** The accepted answer the input matched (or nearly matched), if any. */
  matched: string | null
  /** What to show as the right answer. */
  shown: string
}

export type CheckMode = 'live' | 'final'

/** Minimum letters (without the article) for a one-letter slip to count as a typo. */
export const TYPO_MIN_LETTERS = 5

function langOf(lang: string) {
  return isLanguageCode(lang) ? LANGUAGES[lang] : null
}

function fold(lang: string, s: string): string {
  let t = s
  for (const [from, to] of langOf(lang)?.answerFolds ?? []) t = t.split(from).join(to)
  return t
}

/** Lowercase, NFC, single spaces, no surrounding punctuation, quotes or ellipsis. */
function basic(s: string): string {
  let t = collapseWhitespace(s.normalize('NFC').toLowerCase())
  t = t.replace(/[’']/g, "'").replace(/[\s.!?¡¿,;:"“”„«»…]+$/u, '').replace(/^[\s¡¿"“”„«»…]+/u, '')
  return collapseWhitespace(t)
}

/** A phrase without any punctuation or apostrophes ("I’m sorry." = "im sorry"). */
function phraseText(s: string): string {
  return collapseWhitespace(s.replace(/'/g, '').replace(/[.!?¡¿,;:"“”„«»…()–—-]+/gu, ' '))
}

function stripPrefix(lang: string, s: string): string {
  for (const prefix of langOf(lang)?.answerStripPrefixes ?? []) {
    if (s.startsWith(prefix) && s.length > prefix.length) return s.slice(prefix.length)
  }
  return s
}

/** The normalized comparison form of an answer in `lang`. */
export function normalizeAnswer(lang: string, s: string): string {
  return fold(lang, stripPrefix(lang, basic(s)))
}

type Form = { article: string | null; rest: string; letters: number; text: string }

/** Split a basic()-normalized string into a leading article (when the language has one) and the rest. */
function splitArticle(lang: string, s: string, useArticles: boolean): { article: string | null; rest: string } {
  if (useArticles) {
    const space = s.indexOf(' ')
    if (space > 0) {
      const first = s.slice(0, space)
      if ((langOf(lang)?.articles ?? []).includes(first)) return { article: fold(lang, first), rest: s.slice(space + 1) }
    }
  }
  return { article: null, rest: s }
}

function toForm(lang: string, raw: string, useArticles: boolean, phrase = false): Form {
  const b = stripPrefix(lang, phrase ? phraseText(basic(raw)) : basic(raw))
  const { article, rest } = splitArticle(lang, b, useArticles)
  return { article, rest: fold(lang, rest), letters: [...rest.replace(/[^\p{L}]/gu, '')].length, text: raw.trim() }
}

/** Accepted answers: each split on "," and ";" (not a phrase), "(...)" notes dropped. */
function candidateTexts(expected: Expected): string[] {
  const out: string[] = []
  for (const s of [expected.primary, ...expected.alternatives]) {
    for (const part of expected.isPhrase ? [s] : s.split(/[,;]/)) {
      const t = collapseWhitespace(part.replace(/\([^()]*\)/gu, ' '))
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out
}

/** Optimal string alignment (Damerau) distance, capped: returns max+1 once it is exceeded. */
export function damerau(a: string, b: string, max = 2): number {
  const x = [...a]
  const y = [...b]
  if (Math.abs(x.length - y.length) > max) return max + 1
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }
  return Math.min(d[x.length]![y.length]!, max + 1)
}

/** Check one answer. `lang` is the language the answer is written in. */
export function checkAnswer(input: string, expected: Expected, lang: string, mode: CheckMode): CheckResult {
  const shown = expected.primary
  const useArticles = !!(expected.isNoun && expected.article && langOf(lang)?.requireArticleForNouns)
  const phrase = !!expected.isPhrase
  const candidates = candidateTexts(expected).map((t) => toForm(lang, t, useArticles, phrase))
  const inp = toForm(lang, input, useArticles, phrase)
  const empty = inp.rest === '' && inp.article === null

  if (!empty) {
    for (const c of candidates) {
      if (c.rest === inp.rest && c.article === inp.article) return { verdict: 'correct', matched: c.text, shown }
    }
  }
  if (mode === 'live') return { verdict: 'pending', matched: null, shown }
  if (empty) return { verdict: 'wrong', matched: null, shown }

  if (useArticles) {
    for (const c of candidates) {
      if (c.article && c.rest === inp.rest) {
        return { verdict: inp.article === null ? 'missing-article' : 'wrong-article', matched: c.text, shown: c.text }
      }
    }
  }
  for (const c of candidates) {
    if (c.article !== inp.article || c.letters < TYPO_MIN_LETTERS) continue
    if (damerau(inp.rest, c.rest, 1) <= 1) return { verdict: 'typo', matched: c.text, shown: c.text }
  }
  return { verdict: 'wrong', matched: null, shown }
}

const RANK: Record<Verdict, number> = { correct: 5, typo: 4, 'wrong-article': 3, 'missing-article': 2, pending: 1, wrong: 0 }

/** The best result over several transcripts (speech recognition alternatives). */
export function checkAnyAnswer(inputs: readonly string[], expected: Expected, lang: string, mode: CheckMode): CheckResult & { input: string } {
  let best: (CheckResult & { input: string }) | null = null
  for (const input of inputs.length > 0 ? inputs : ['']) {
    const r = { ...checkAnswer(input, expected, lang, mode), input }
    if (!best || RANK[r.verdict] > RANK[best.verdict]) best = r
  }
  return best!
}

/** The default grade of a verdict: correct Good, typo Hard, anything else Again. */
export function gradeForVerdict(v: Verdict): Grade {
  return v === 'correct' ? 3 : v === 'typo' ? 2 : 1
}

/** The sentence shown and announced for a result. */
export function verdictText(r: Pick<CheckResult, 'verdict' | 'shown'>, ui: UiLanguage = 'en'): string {
  if (ui === 'es') {
    switch (r.verdict) {
      case 'correct':
        return '¡Correcto!'
      case 'typo':
        return 'Casi: revisa la ortografía'
      case 'missing-article':
        return `Falta el artículo: ${r.shown}`
      case 'wrong-article':
        return `Artículo incorrecto: ${r.shown}`
      default:
        return `No exactamente. La respuesta es ${r.shown}`
    }
  }
  switch (r.verdict) {
    case 'correct':
      return 'Correct'
    case 'typo':
      return 'Almost — check the spelling'
    case 'missing-article':
      return `Missing the article: ${r.shown}`
    case 'wrong-article':
      return `Wrong article: ${r.shown}`
    default:
      return `Not quite. The answer is ${r.shown}`
  }
}

// ---------- reveal diff ----------

export type DiffSegment = { text: string; op: 'equal' | 'insert' | 'delete' }

/**
 * Character diff of `input` against `expected` (case-insensitive LCS): 'equal' parts, 'insert'
 * = in the expected answer but missing from the input, 'delete' = typed but not expected.
 */
export function diffChars(input: string, expected: string): DiffSegment[] {
  const a = [...input.trim()]
  const b = [...expected.trim()]
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      L[i]![j] = eq(a[i]!, b[j]!) ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
    }
  }
  const out: DiffSegment[] = []
  const push = (text: string, op: DiffSegment['op']) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ text, op })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (eq(a[i]!, b[j]!)) {
      push(b[j]!, 'equal')
      i++
      j++
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) push(a[i++]!, 'delete')
    else push(b[j++]!, 'insert')
  }
  while (i < a.length) push(a[i++]!, 'delete')
  while (j < b.length) push(b[j++]!, 'insert')
  return out
}

// ---------- what a card expects ----------

export type AnswerCardInput = {
  display: string
  translation: string | null
  extraTranslations: readonly string[]
  content: { pos: string | null; altTranslations: readonly string[]; grammar: { article: string | null } | null } | null
}

/**
 * What the learner should type for a card shown in `direction`, and in which language:
 * target -> source expects the translation (plus alt and extra translations); source -> target
 * expects the word as displayed (with its article).
 */
export function expectedFor(
  card: AnswerCardInput,
  direction: FaceDirection,
  langs: { sourceLang: LanguageCode | string; targetLang: LanguageCode | string },
): { expected: Expected; lang: string } {
  const phrase = card.content?.pos === 'phrase' ? { isPhrase: true } : {}
  if (direction === 'target-source') {
    const primary = card.translation ?? card.extraTranslations[0] ?? card.display
    return {
      lang: langs.sourceLang,
      expected: { primary, alternatives: [...(card.content?.altTranslations ?? []), ...card.extraTranslations], isNoun: false, article: null, ...phrase },
    }
  }
  return {
    lang: langs.targetLang,
    expected: {
      primary: card.display,
      alternatives: [],
      isNoun: card.content?.pos === 'noun',
      article: card.content?.grammar?.article ?? null,
      ...phrase,
    },
  }
}
