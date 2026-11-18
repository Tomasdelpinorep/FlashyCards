/**
 * Display view of a card: the cached entry merged with the card's own `override_json`, plus
 * helpers for the `[[ ]]` highlight markers, the "· also: ..." translation line, verb/plural
 * forms, and duplicate references. Shared by the Worker (building the Card DTO) and the client
 * (rendering it). No language branches: articles/genders come from languages.ts.
 */
import { LANGUAGES, isLanguageCode } from './languages'

export type GrammarView = {
  gender: 'masculine' | 'feminine' | 'neuter' | null
  article: string | null
  plural: string | null
  genitive: string | null
  verb: {
    present_3sg: string | null
    past_3sg: string | null
    perfect_3sg: string | null
    participle: string | null
    auxiliary: string | null
    separable: boolean | null
    reflexive: boolean | null
  } | null
  governs_case: string | null
  comparative: string | null
  superlative: string | null
  note: string | null
}

/** The generated content of a card, after applying the card's override. */
export type CardContent = {
  lemma: string
  pos: string | null
  translation: string | null
  altTranslations: string[]
  cefr: string | null
  grammar: GrammarView | null
  /** Target-language sentence; may contain [[ ]] around the word. */
  exampleTarget: string | null
  /** Source-language sentence; may contain [[ ]] around the translated word. */
  exampleSource: string | null
}

/** Fields a user override (override_json, written by M8's edit/regenerate) may replace. */
export type ContentOverride = Partial<Omit<CardContent, 'grammar'>> & { grammar?: Partial<GrammarView> }

/** Entry columns as stored in D1. */
export type EntryColumns = {
  lemma: string
  pos: string | null
  translation: string | null
  alt_translations_json: string | null
  cefr: string | null
  grammar_json: string | null
  example_target: string | null
  example_source: string | null
}

function parseJson<T>(json: string | null | undefined): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Merge an entry with a card's override_json. Returns null when there is no entry and no lemma override. */
export function mergeContent(entry: EntryColumns | null, overrideJson: string | null | undefined): CardContent | null {
  const o = parseJson<ContentOverride>(overrideJson) ?? {}
  const base: CardContent | null = entry
    ? {
        lemma: entry.lemma,
        pos: entry.pos,
        translation: entry.translation,
        altTranslations: stringArray(parseJson(entry.alt_translations_json)),
        cefr: entry.cefr,
        grammar: parseJson<GrammarView>(entry.grammar_json),
        exampleTarget: entry.example_target,
        exampleSource: entry.example_source,
      }
    : null
  if (!base && !o.lemma) return null
  const b: CardContent = base ?? {
    lemma: o.lemma!,
    pos: null,
    translation: null,
    altTranslations: [],
    cefr: null,
    grammar: null,
    exampleTarget: null,
    exampleSource: null,
  }
  return {
    lemma: o.lemma ?? b.lemma,
    pos: o.pos !== undefined ? o.pos : b.pos,
    translation: o.translation !== undefined ? o.translation : b.translation,
    altTranslations: o.altTranslations ? stringArray(o.altTranslations) : b.altTranslations,
    cefr: o.cefr !== undefined ? o.cefr : b.cefr,
    grammar: o.grammar ? ({ ...emptyGrammar(), ...b.grammar, ...o.grammar } as GrammarView) : b.grammar,
    exampleTarget: o.exampleTarget !== undefined ? o.exampleTarget : b.exampleTarget,
    exampleSource: o.exampleSource !== undefined ? o.exampleSource : b.exampleSource,
  }
}

function emptyGrammar(): GrammarView {
  return {
    gender: null,
    article: null,
    plural: null,
    genitive: null,
    verb: null,
    governs_case: null,
    comparative: null,
    superlative: null,
    note: null,
  }
}

// ---------- word display ----------

/** "Hund" + article "der" -> "der Hund" (unless the lemma already starts with it). */
export function withArticle(lemma: string, article: string | null | undefined): string {
  const a = article?.trim()
  if (a && !lemma.toLowerCase().startsWith(`${a.toLowerCase()} `)) return `${a} ${lemma}`
  return lemma
}

/** The colour token of a word's leading article in `lang` (der blue, die red, das green), if any. */
export function articleColor(lang: string, word: string): { article: string; rest: string; color: 'blue' | 'red' | 'green' } | null {
  const colors = isLanguageCode(lang) ? LANGUAGES[lang].genderColors : undefined
  const space = word.indexOf(' ')
  if (!colors || space <= 0) return null
  const article = word.slice(0, space)
  const color = colors[article.toLowerCase()]
  return color ? { article, rest: word.slice(space), color } : null
}

/** "big · also: large, tall" (extras are the user's own extra translations). */
export function translationLine(translation: string | null, extras: readonly string[]): string {
  const main = translation ?? extras[0] ?? ''
  const rest = translation ? extras : extras.slice(1)
  const others = rest.filter((x) => x.toLowerCase() !== main.toLowerCase())
  if (!main) return ''
  return others.length > 0 ? `${main} · also: ${others.join(', ')}` : main
}

/**
 * The forms worth showing next to the word: the plural for nouns, the 3rd person present ·
 * past · perfect for verbs, the comparative · superlative for adjectives.
 */
export function formsLine(content: Pick<CardContent, 'pos' | 'grammar'> | null): string | null {
  const g = content?.grammar
  if (!g) return null
  const join = (parts: (string | null | undefined)[]) => {
    const p = parts.filter((x): x is string => !!x && x.trim() !== '')
    return p.length > 0 ? p.join(' · ') : null
  }
  if (content.pos === 'verb' && g.verb) return join([g.verb.present_3sg, g.verb.past_3sg, g.verb.perfect_3sg])
  if (content.pos === 'noun') return g.plural ? `Plural: ${g.plural}` : null
  if (content.pos === 'adjective' || content.pos === 'adverb') return join([g.comparative, g.superlative])
  if (g.governs_case) return `+ ${g.governs_case}`
  return null
}

// ---------- [[ ]] highlight markers ----------

export type Segment = { text: string; mark: boolean }

const MARKER = /\[\[([^[\]]+)\]\]/g

/** True when the sentence has at least one well-formed [[...]] and no stray brackets. */
export function hasValidMarkers(s: string | null | undefined): boolean {
  if (!s) return false
  const rest = s.replace(MARKER, '')
  return rest !== s && !rest.includes('[[') && !rest.includes(']]')
}

/** The sentence without any [[ ]] markers (stray brackets removed too). */
export function stripMarkers(s: string): string {
  return s.replace(MARKER, '$1').replace(/\[\[|\]\]/g, '')
}

/**
 * Split a sentence into plain and highlighted parts. A sentence without valid markers is
 * shown without highlighting (PLAN section 5 post-validation).
 */
export function highlightSegments(s: string | null | undefined): Segment[] {
  if (!s) return []
  if (!hasValidMarkers(s)) return [{ text: stripMarkers(s), mark: false }]
  const out: Segment[] = []
  let last = 0
  for (const m of s.matchAll(MARKER)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), mark: false })
    out.push({ text: m[1]!, mark: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), mark: false })
  return out
}

// ---------- duplicates ----------

/** "Already in your deck as der Hund" for a card with status 'duplicate'. */
export function duplicateOfText(duplicateOf: { display: string } | undefined): string {
  return duplicateOf ? `Already in your deck as ${duplicateOf.display}` : 'Already in your deck'
}
