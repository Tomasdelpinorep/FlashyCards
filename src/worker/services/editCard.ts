/**
 * PATCH /cards/:id (M8): edit a card's translation, sentences, note and extra translations, and
 * suspend/unsuspend it. Edits live in cards.override_json (merged over the shared entry by
 * mergeContent), so the entry, the lemma and lemma_key are never touched. When the translation or
 * the extras change, the card's card_glosses are rewritten with the same rule /generate uses
 * (resolvedCardGlosses), all in ONE db.batch.
 */
import { mergeContent, type ContentOverride } from '../../shared/display'
import type { LanguageCode } from '../../shared/languages'
import { glossKey } from '../../shared/normalize'
import type { CardDTO, UpdateCardInput } from '../../shared/schemas'
import { getCard, LIST_SELECT, type CardListRow } from '../db/cards'
import { parseJsonArray } from '../db/util'
import { glossInsertStatement, resolvedCardGlosses } from './resolve'

export type UpdateCardResult = { card: CardDTO } | { error: 'not_found' } | { error: 'card_not_ready'; status: string }

const EDITABLE = new Set(['ready', 'suspended'])
const OVERRIDE_FIELDS = ['translation', 'exampleTarget', 'exampleSource'] as const

/** Trim, drop empties, de-duplicate by gloss key (first spelling wins). */
export function cleanExtras(src: LanguageCode, extras: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of extras) {
    const x = raw.trim()
    const k = glossKey(src, x)
    if (!x || !k || seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

export async function updateCard(db: D1Database, userId: string, cardId: string, input: UpdateCardInput): Promise<UpdateCardResult> {
  const row = await db
    .prepare(
      `${LIST_SELECT.replace('FROM cards c', ', d.source_lang AS d_source_lang FROM cards c JOIN decks d ON d.id = c.deck_id')}
       WHERE c.id = ? AND c.status <> 'deleted' AND d.user_id = ?`,
    )
    .bind(cardId, userId)
    .first<CardListRow & { d_source_lang: LanguageCode }>()
  if (!row) return { error: 'not_found' }
  if (!EDITABLE.has(row.status)) return { error: 'card_not_ready', status: row.status }
  const src = row.d_source_lang

  // Merge the edit into the existing override: '' / null removes a key (falls back to the entry).
  let override: ContentOverride = {}
  try {
    const parsed = JSON.parse(row.override_json ?? '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) override = parsed as ContentOverride
  } catch {
    override = {}
  }
  const prevTranslation = override.translation
  for (const f of OVERRIDE_FIELDS) {
    const v = input[f]
    if (v === undefined) continue
    if (v === null || v === '') delete override[f]
    else override[f] = v
  }
  const overrideJson = Object.keys(override).length > 0 ? JSON.stringify(override) : null
  const translationChanged = override.translation !== prevTranslation

  const oldExtras = parseJsonArray(row.extra_translations_json)
  const extras = input.extraTranslations !== undefined ? cleanExtras(src, input.extraTranslations) : oldExtras
  const extrasChanged = JSON.stringify(extras) !== JSON.stringify(oldExtras)

  const note = input.note === undefined ? row.note : input.note || null
  const status = input.status ?? row.status
  const now = Date.now()

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE cards SET override_json = ?1, note = ?2, extra_translations_json = ?3, status = ?4, updated_at = ?5
         WHERE id = ?6 AND status IN ('ready','suspended')`,
      )
      .bind(overrideJson, note, JSON.stringify(extras), status, now, cardId),
  ]
  if (translationChanged || extrasChanged) {
    const merged = mergeContent(
      row.e_lemma === null
        ? null
        : {
            lemma: row.e_lemma,
            pos: row.e_pos,
            translation: row.e_translation,
            alt_translations_json: row.e_alts,
            cefr: row.e_cefr,
            grammar_json: row.e_grammar,
            example_target: row.e_example_target,
            example_source: row.e_example_source,
          },
      overrideJson,
    )
    const glosses = resolvedCardGlosses(
      src,
      { translation: merged?.translation ?? null, alt_translations_json: JSON.stringify(merged?.altTranslations ?? []) },
      { hintKey: row.hint_key, inputTerm: row.input_term, side: row.input_side ?? (row.input_lang === 'source' ? 'source' : null), extras },
    )
    statements.push(
      db.prepare('DELETE FROM card_glosses WHERE card_id = ?').bind(cardId),
      glossInsertStatement(
        db,
        [...glosses].map((g): [string, string] => [cardId, g]),
        "WHERE c.status IN ('ready','suspended')",
      ),
    )
  }
  await db.batch(statements)
  const card = await getCard(db, userId, cardId)
  return card ? { card } : { error: 'not_found' }
}
