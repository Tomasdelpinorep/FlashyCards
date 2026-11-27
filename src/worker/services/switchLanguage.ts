/**
 * Switching the app language (Settings -> Language, PATCH /me { settings: { uiLang } }). The app
 * language is also the source ("I speak") language of the user's decks, so switching converts
 * every deck it can, keeping all cards, reviews and FSRS state (docs/DECISIONS.md "App language"):
 *
 * - decks.source_lang becomes the new language. Decks whose target IS the new language (an
 *   English speaker's en -> es deck, when switching to Spanish) can't be converted and stay as
 *   they are.
 * - Each card's entry_id moves to the entry with the same German lemma (same target language,
 *   lemma_key and sense_key) for the new pair, e.g. cur-de-hund (en) -> cur-es-de-hund (es). A
 *   card whose entry has no counterpart keeps its old entry (and so its old-language meaning).
 * - Meanings the user typed or edited (cards.override_json) and extra translations are the user's
 *   own text and are kept as they are.
 * - Cards still waiting for a meaning go back to pending, so /generate looks them up in the new
 *   pair's dictionary.
 * - card_glosses (duplicate detection, "Also in your deck") are rebuilt with the new language's keys.
 * - A deck still called by its default name ("German") is renamed for the new language ("Alemán").
 *
 * One read, then ONE db.batch with the user's new settings, so the switch is all or nothing.
 */
import { languageName, type LanguageCode, type UiLanguage } from '../../shared/languages'
import type { UserSettings } from '../../shared/schemas'
import { parseJsonArray } from '../db/util'
import { glossInsertStatement, resolvedCardGlosses, type Side } from './resolve'

type ConvertRow = {
  id: string
  hint_key: string
  input_term: string
  input_side: Side | null
  extra_translations_json: string | null
  override_json: string | null
  translation: string | null
  alt_translations_json: string | null
}

type DeckLangRow = { id: string; name: string; source_lang: string; target_lang: string }

/** The default deck name in a language: "German" / "Alemán" (as db/decks.ts defaultDeckFor names it). */
export function defaultDeckName(target: string, ui: UiLanguage): string {
  const name = languageName(target, ui)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Saves `settings` (whose uiLang is the new language) and converts the user's decks to it. */
export async function switchAppLanguage(db: D1Database, userId: string, settings: UserSettings, now = Date.now()): Promise<void> {
  const lang = settings.uiLang
  const { results: decks } = await db
    .prepare('SELECT id, name, source_lang, target_lang FROM decks WHERE user_id = ?1 AND source_lang <> ?2 AND target_lang <> ?2')
    .bind(userId, lang)
    .all<DeckLangRow>()
  const saveSettings = db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').bind(JSON.stringify(settings), userId)
  if (decks.length === 0) {
    await saveSettings.run()
    return
  }
  const deckIds = JSON.stringify(decks.map((d) => d.id))

  // The glosses each resolved card will have after the switch (its new entry, else its old one).
  const { results: cards } = await db
    .prepare(
      `SELECT c.id, c.hint_key, c.input_term, c.input_side, c.extra_translations_json, c.override_json,
              COALESCE(n.translation, e.translation) AS translation,
              COALESCE(n.alt_translations_json, e.alt_translations_json) AS alt_translations_json
       FROM cards c
       LEFT JOIN entries e ON e.id = c.entry_id
       LEFT JOIN entries n ON n.source_lang = ?1 AND n.target_lang = e.target_lang AND n.lemma_key = e.lemma_key AND n.sense_key = e.sense_key
       WHERE c.deck_id IN (SELECT value FROM json_each(?2)) AND c.status IN ('ready', 'suspended')`,
    )
    .bind(lang, deckIds)
    .all<ConvertRow>()
  const pairs: [string, string][] = []
  for (const c of cards) {
    const own = ownTranslation(c.override_json)
    const entry = { translation: own ?? c.translation, alt_translations_json: own ? null : c.alt_translations_json }
    const glosses = resolvedCardGlosses(lang as LanguageCode, entry, {
      hintKey: c.hint_key,
      inputTerm: c.input_term,
      side: c.input_side,
      extras: parseJsonArray(c.extra_translations_json),
    })
    for (const g of glosses) pairs.push([c.id, g])
  }

  const renames = decks
    .filter((d) => d.name === defaultDeckName(d.target_lang, d.source_lang as UiLanguage))
    .map((d) => [d.id, defaultDeckName(d.target_lang, lang)])

  await db.batch([
    saveSettings,
    db
      .prepare(
        `UPDATE cards SET
           entry_id = (SELECT n.id FROM entries e JOIN entries n
                         ON n.source_lang = ?1 AND n.target_lang = e.target_lang AND n.lemma_key = e.lemma_key AND n.sense_key = e.sense_key
                       WHERE e.id = cards.entry_id),
           updated_at = ?3
         WHERE deck_id IN (SELECT value FROM json_each(?2)) AND entry_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM entries e JOIN entries n
                         ON n.source_lang = ?1 AND n.target_lang = e.target_lang AND n.lemma_key = e.lemma_key AND n.sense_key = e.sense_key
                       WHERE e.id = cards.entry_id)`,
      )
      .bind(lang, deckIds, now),
    db
      .prepare(
        `UPDATE cards SET status = 'pending', gen_error = NULL, gen_attempts = 0, gen_claimed_at = NULL, updated_at = ?2
         WHERE deck_id IN (SELECT value FROM json_each(?1)) AND status = 'failed' AND gen_error = 'needs_meaning' AND override_json IS NULL`,
      )
      .bind(deckIds, now),
    db.prepare('UPDATE decks SET source_lang = ?1 WHERE id IN (SELECT value FROM json_each(?2))').bind(lang, deckIds),
    db
      .prepare(`UPDATE decks SET name = json_extract(j.value, '$[1]') FROM json_each(?1) j WHERE decks.id = json_extract(j.value, '$[0]')`)
      .bind(JSON.stringify(renames)),
    db.prepare('DELETE FROM card_glosses WHERE deck_id IN (SELECT value FROM json_each(?1))').bind(deckIds),
    glossInsertStatement(db, pairs),
  ])
}

/** The translation the user typed or edited (override_json.translation), if any. */
function ownTranslation(overrideJson: string | null): string | null {
  if (!overrideJson) return null
  try {
    const o = JSON.parse(overrideJson) as { translation?: unknown }
    return typeof o.translation === 'string' && o.translation.trim() ? o.translation : null
  } catch {
    return null
  }
}
