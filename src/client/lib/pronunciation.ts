/** A YouTube search for a pronunciation video of `word` (with its article for nouns, e.g. "der Hund"). */
import { isLanguageCode, LANGUAGES } from '../../shared/languages'

export function pronunciationVideoUrl(word: string, lang: string): string {
  const name = isLanguageCode(lang) ? LANGUAGES[lang].name : lang
  const suffix = lang === 'de' ? 'German Pronunciation' : name
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to pronounce ${word.trim()} ${suffix}`)}`
}
