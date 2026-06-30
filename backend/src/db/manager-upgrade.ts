import type { Database } from 'bun:sqlite'

export type ManagerUpgradeStatus = 'pending' | 'pulling' | 'recreating' | 'completed' | 'failed'

export interface ManagerUpgradeJob {
  id: number
  status: ManagerUpgradeStatus
  fromVersion: string | null
  toVersion: string | null
  targetImage: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

interface ManagerUpgradeJobRow {
  id: number
  status: string
  from_version: string | null
  to_version: string | null
  target_image: string | null
  error: string | null
  started_at: number
  finished_at: number | null
}

function rowToJob(row: ManagerUpgradeJobRow): ManagerUpgradeJob {
  return {
    id: row.id,
    status: row.status as ManagerUpgradeStatus,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    targetImage: row.target_image,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export function insertUpgradeJob(
  db: Database,
  data: {
    status: ManagerUpgradeStatus
    fromVersion?: string
    toVersion?: string
    targetImage?: string
    startedAt: number
  },
): ManagerUpgradeJob {
  const stmt = db.prepare(`
    INSERT INTO manager_upgrade_jobs (status, from_version, to_version, target_image, started_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    data.status,
    data.fromVersion ?? null,
    data.toVersion ?? null,
    data.targetImage ?? null,
    data.startedAt,
  )

  const row = db.prepare('SELECT * FROM manager_upgrade_jobs WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ManagerUpgradeJobRow | undefined

  if (!row) {
    throw new Error('Failed to retrieve newly created upgrade job')
  }

  return rowToJob(row)
}

export function updateUpgradeJob(
  db: Database,
  id: number,
  patch: Partial<{
    status: ManagerUpgradeStatus
    error: string | null
    finishedAt: number | null
  }>,
): void {
  const sets: string[] = []
  const values: unknown[] = []

  if (patch.status !== undefined) {
    sets.push('status = ?')
    values.push(patch.status)
  }
  if (patch.error !== undefined) {
    sets.push('error = ?')
    values.push(patch.error)
  }
  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = ?')
    values.push(patch.finishedAt)
  }

  if (sets.length === 0) return

  values.push(id)
  db.prepare(`UPDATE manager_upgrade_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values as never)
}

export function getLatestUpgradeJob(db: Database): ManagerUpgradeJob | null {
  const row = db.prepare('SELECT * FROM manager_upgrade_jobs ORDER BY id DESC LIMIT 1')
    .get() as ManagerUpgradeJobRow | undefined

  return row ? rowToJob(row) : null
}

export function getActiveUpgradeJob(db: Database): ManagerUpgradeJob | null {
  const row = db.prepare(
    "SELECT * FROM manager_upgrade_jobs WHERE status IN ('pending', 'pulling', 'recreating') ORDER BY id DESC LIMIT 1",
  ).get() as ManagerUpgradeJobRow | undefined

  return row ? rowToJob(row) : null
}
