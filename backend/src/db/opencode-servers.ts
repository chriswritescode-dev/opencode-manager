import { randomBytes } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { decryptSecret, encryptSecret } from '../utils/crypto'
import { logger } from '../utils/logger'

interface OpenCodeServerRow {
  id: string
  name: string
  base_url: string
  username: string
  enabled: number
  created_at: number
  updated_at: number
  has_password: number
}

export interface OpenCodeServerInsert {
  name: string
  baseUrl: string
  username: string
  enabled: boolean
  password?: string | null
}

export interface OpenCodeServerUpdate {
  name?: string
  baseUrl?: string
  username?: string
  enabled?: boolean
  password?: string | null
}

const ROW_COLUMNS = 'id, name, base_url, username, enabled, created_at, updated_at'

const SELECT_SERVER = `
  SELECT s.id, s.name, s.base_url, s.username, s.enabled, s.created_at, s.updated_at,
         CASE WHEN k.key IS NULL THEN 0 ELSE 1 END AS has_password
  FROM opencode_servers s
  LEFT JOIN app_secrets k ON k.key = 'opencode_server:' || s.id || ':password'
`

export function normalizeOpenCodeServerBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function passwordSecretKey(serverId: string): string {
  return `opencode_server:${serverId}:password`
}

function mapRow(row: OpenCodeServerRow): OpenCodeServer {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    username: row.username,
    enabled: row.enabled === 1,
    hasPassword: row.has_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listOpenCodeServers(db: Database): OpenCodeServer[] {
  const rows = db
    .prepare(`${SELECT_SERVER} ORDER BY s.name COLLATE NOCASE, s.created_at`)
    .all() as OpenCodeServerRow[]
  return rows.map(mapRow)
}

export function getOpenCodeServer(db: Database, serverId: string): OpenCodeServer | null {
  const row = db
    .prepare(`${SELECT_SERVER} WHERE s.id = ?`)
    .get(serverId) as OpenCodeServerRow | undefined
  return row ? mapRow(row) : null
}

export function readOpenCodeServerPassword(db: Database, serverId: string): string | null {
  const row = db
    .prepare('SELECT value FROM app_secrets WHERE key = ?')
    .get(passwordSecretKey(serverId)) as { value: string } | undefined
  if (!row) return null

  try {
    return decryptSecret(row.value)
  } catch (error) {
    logger.error(`Failed to decrypt the password for OpenCode server ${serverId}`, error)
    return null
  }
}

export function setOpenCodeServerPassword(db: Database, serverId: string, password: string): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(passwordSecretKey(serverId), encryptSecret(password), now, now)
}

export function clearOpenCodeServerPassword(db: Database, serverId: string): void {
  db.prepare('DELETE FROM app_secrets WHERE key = ?').run(passwordSecretKey(serverId))
}

export function insertOpenCodeServer(db: Database, input: OpenCodeServerInsert): OpenCodeServer {
  const id = `srv_${randomBytes(18).toString('base64url')}`
  const now = Date.now()

  const insert = db.transaction(() => {
    db.prepare(`INSERT INTO opencode_servers (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.name,
      normalizeOpenCodeServerBaseUrl(input.baseUrl),
      input.username,
      input.enabled ? 1 : 0,
      now,
      now,
    )
    if (input.password) {
      setOpenCodeServerPassword(db, id, input.password)
    }
    return getOpenCodeServer(db, id)
  })

  const server = insert()
  if (!server) {
    throw new Error(`Failed to read the OpenCode server inserted with id ${id}`)
  }
  return server
}

export function updateOpenCodeServer(
  db: Database,
  serverId: string,
  patch: OpenCodeServerUpdate,
): OpenCodeServer | null {
  const update = db.transaction(() => {
    if (!getOpenCodeServer(db, serverId)) return null

    const assignments: string[] = []
    const values: Array<string | number> = []

    if (patch.name !== undefined) {
      assignments.push('name = ?')
      values.push(patch.name)
    }
    if (patch.baseUrl !== undefined) {
      assignments.push('base_url = ?')
      values.push(normalizeOpenCodeServerBaseUrl(patch.baseUrl))
    }
    if (patch.username !== undefined) {
      assignments.push('username = ?')
      values.push(patch.username)
    }
    if (patch.enabled !== undefined) {
      assignments.push('enabled = ?')
      values.push(patch.enabled ? 1 : 0)
    }

    assignments.push('updated_at = ?')
    values.push(Date.now())

    db.prepare(`UPDATE opencode_servers SET ${assignments.join(', ')} WHERE id = ?`).run(...values, serverId)

    if (patch.password === null) {
      clearOpenCodeServerPassword(db, serverId)
    } else if (patch.password !== undefined) {
      setOpenCodeServerPassword(db, serverId, patch.password)
    }

    return getOpenCodeServer(db, serverId)
  })

  return update()
}

export function deleteOpenCodeServer(db: Database, serverId: string): boolean {
  const remove = db.transaction(() => {
    const result = db.prepare('DELETE FROM opencode_servers WHERE id = ?').run(serverId)
    clearOpenCodeServerPassword(db, serverId)
    return result.changes > 0
  })

  return remove()
}
