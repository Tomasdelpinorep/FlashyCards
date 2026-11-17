/**
 * Normalization keys used for duplicate detection (PLAN.md section 3, docs/DUPLICATES.md
 * section 10.1). Language-specific data (articles, gloss prefixes) comes from languages.ts;
 * this file has no per-language branches.
 */
import { LANGUAGES, type LanguageCode } from './languages'

/** Trim and collapse every run of whitespace to a single space. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Characters that start a dictionary-style plural ending: "-e", "¨-er", "-¨er", "–s". */
const PLURAL_MARK = '[-‐‑–—¨"]'

/**
 * Remove dictionary plural notation:
 * - "Hund, -e", "Mann, ¨-er", "Zimmer, -", "Hund, pl. Hunde", "Hund, die Hunde"
 * - "Hund (pl. Hunde)", "Hund (Pl.: Hunde)", "Hund (plural Hunde)", "Hund (-e)"
 * A comma followed by anything else is left alone (it may be part of the term).
 */
function stripPluralNotation(lang: LanguageCode, s: string): string {
  const articles = LANGUAGES[lang].articles.map(escapeRegExp).join('|')
  return s
    .replace(new RegExp(`\\s*\\(\\s*(?:pl\\.|pl\\b|plural\\b|${PLURAL_MARK})[^)]*\\)`, 'giu'), ' ')
    .replace(new RegExp(`\\s*,\\s*(?:${PLURAL_MARK}.*|pl\\..*|pl\\b.*|plural\\b.*)$`, 'iu'), '')
    .replace(new RegExp(`\\s*,\\s*(?:${articles})\\s+\\S+$`, 'iu'), '')
}

/** Strip one leading article ("der Hund" -> "Hund"), unless the article is the whole term. */
function stripLeadingArticle(lang: LanguageCode, s: string): string {
  const lower = s.toLowerCase()
  for (const article of LANGUAGES[lang].articles) {
    if (lower.startsWith(article + ' ') && s.length > article.length + 1) return s.slice(article.length + 1)
  }
  return s
}

/**
 * Identity key of an input term in `lang`: NFC, trim, collapse whitespace, strip a leading
 * article, strip plural notation, lowercase. "der Hund, -e" -> "hund".
 */
export function termKey(lang: LanguageCode, s: string): string {
  let t = collapseWhitespace(s.normalize('NFC'))
  t = stripLeadingArticle(lang, t)
  t = collapseWhitespace(stripPluralNotation(lang, t))
  return t.toLowerCase()
}

/**
 * Key of a gloss (translation or meaning hint) in `lang`: NFC, lowercase, trim, drop
 * "(...)", strip one of the language's glossStripPrefixes, collapse whitespace.
 * "To begin (sth.)" -> "begin". A prefix is kept when it is the whole gloss ("to").
 */
export function glossKey(lang: LanguageCode, s: string): string {
  let t = s.normalize('NFC').toLowerCase()
  t = collapseWhitespace(t.replace(/\([^()]*\)/gu, ' '))
  for (const prefix of LANGUAGES[lang].glossStripPrefixes) {
    if (t.startsWith(prefix) && t.length > prefix.length) {
      t = t.slice(prefix.length)
      break
    }
  }
  return collapseWhitespace(t)
}
