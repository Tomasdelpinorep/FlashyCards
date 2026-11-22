import { DEFAULT_SOURCE, DEFAULT_TARGET, LANGUAGES } from '../../shared/languages'
import { DEFAULT_DECK_SETTINGS, DeckSettingsSchema, parseSettings, type DeckDTO, type DeckSettings } from '../../shared/schemas'

export type DeckRow = {
  id: string
  user_id: string
  name: string
  source_lang: string
  target_lang: string
  settings_json: string
  created_at: number
}

export type NewDeck = { name: string; sourceLang: string; targetLang: string; settings: DeckSettings }

/** The deck every user gets when their user row is created (first login): English speaker learning German. */
export const DEFAULT_DECK: NewDeck = {
  name: LANGUAGES[DEFAULT_TARGET].name,
  sourceLang: DEFAULT_SOURCE,
  targetLang: DEFAULT_TARGET,
  settings: DEFAULT_DECK_SETTINGS,
}

export async function listDecks(db: D1Database, userId: string): Promise<DeckRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY created_at, id')
    .bind(userId)
    .all<DeckRow>()
  return results
}

/** Ownership-checked lookup: returns null both for missing decks and other users' decks. */
export async function getDeck(db: D1Database, userId: string, deckId: string): Promise<DeckRow | null> {
  return db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').bind(deckId, userId).first<DeckRow>()
}

export async function createDeck(db: D1Database, userId: string, deck: NewDeck): Promise<DeckRow> {
  const row = await db
    .prepare(
      'INSERT INTO decks (id, user_id, name, source_lang, target_lang, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(crypto.randomUUID(), userId, deck.name, deck.sourceLang, deck.targetLang, JSON.stringify(deck.settings), Date.now())
    .first<DeckRow>()
  if (!row) throw new Error('deck insert failed')
  return row
}

export async function updateDeck(
  db: D1Database,
  userId: string,
  deckId: string,
  patch: { name?: string; settings?: DeckSettings },
): Promise<DeckRow | null> {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name)
  }
  if (patch.settings !== undefined) {
    sets.push('settings_json = ?')
    params.push(JSON.stringify(patch.settings))
  }
  if (sets.length === 0) return getDeck(db, userId, deckId)
  return db
    .prepare(`UPDATE decks SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
    .bind(...params, deckId, userId)
    .first<DeckRow>()
}

/** Deletes the deck (cards and review logs cascade). Returns false if not found / not owned. */
export async function deleteDeck(db: D1Database, userId: string, deckId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').bind(deckId, userId).run()
  return res.meta.changes > 0
}

export function deckSettings(row: DeckRow): DeckSettings {
  return parseSettings(DeckSettingsSchema, DEFAULT_DECK_SETTINGS, row.settings_json)
}

export function toDeckDTO(row: DeckRow): DeckDTO {
  return {
    id: row.id,
    name: row.name,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    settings: deckSettings(row),
    createdAt: row.created_at,
  }
}
