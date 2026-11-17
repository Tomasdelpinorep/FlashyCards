import { DEFAULT_USER_SETTINGS, parseSettings, UserSettingsSchema, type UserDTO, type UserSettings } from '../../shared/schemas'

export type UserRow = {
  id: string
  email: string
  display_name: string | null
  settings_json: string
  created_at: number
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>()
}

/**
 * Return the user for `email` (lowercased), creating it if missing. Reads first so the
 * common path costs no D1 write; the insert is conflict-safe for concurrent first requests.
 */
export async function upsertUser(db: D1Database, rawEmail: string): Promise<UserRow> {
  const email = rawEmail.trim().toLowerCase()
  const existing = await getUserByEmail(db, email)
  if (existing) return existing
  await db
    .prepare('INSERT INTO users (id, email, settings_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), email, '{}', Date.now())
    .run()
  const row = await getUserByEmail(db, email)
  if (!row) throw new Error('user upsert failed')
  return row
}

export async function updateUser(
  db: D1Database,
  id: string,
  patch: { displayName?: string | null; settings?: UserSettings },
): Promise<UserRow> {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?')
    params.push(patch.displayName)
  }
  if (patch.settings !== undefined) {
    sets.push('settings_json = ?')
    params.push(JSON.stringify(patch.settings))
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params, id)
      .run()
  }
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  if (!row) throw new Error('user not found')
  return row
}

export function userSettings(row: UserRow): UserSettings {
  return parseSettings(UserSettingsSchema, DEFAULT_USER_SETTINGS, row.settings_json)
}

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    settings: userSettings(row),
    createdAt: row.created_at,
  }
}
