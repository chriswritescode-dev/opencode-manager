import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { getReposPath } from '../config'
import path from 'path'

export interface RepoRow {
  id: number
  repo_url: string
  local_path: string
  branch?: string
  default_branch: string
  clone_status: string
  cloned_at: number
  last_pulled?: number
  opencode_config_name?: string
  is_worktree?: number
}

function rowToRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    repoUrl: row.repo_url,
    localPath: row.local_path,
    fullPath: path.join(getReposPath(), row.local_path),
    branch: row.branch,
    defaultBranch: row.default_branch,
    cloneStatus: row.clone_status as Repo['cloneStatus'],
    clonedAt: row.cloned_at,
    lastPulled: row.last_pulled,
    openCodeConfigName: row.opencode_config_name,
    isWorktree: row.is_worktree ? Boolean(row.is_worktree) : undefined,
  }
}

export function createRepo(db: Database, repo: CreateRepoInput): Repo {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, is_worktree)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  
  const result = stmt.run(
    repo.repoUrl,
    repo.localPath,
    repo.branch || null,
    repo.defaultBranch,
    repo.cloneStatus,
    repo.clonedAt,
    repo.isWorktree ? 1 : 0
  )
  
  if (result.changes === 0) {
    const existing = getRepoByUrlAndBranch(db, repo.repoUrl, repo.branch)
    if (existing) {
      return existing
    }
    throw new Error('Failed to create repo and no existing repo found')
  }
  
  const newRepo = getRepoById(db, Number(result.lastInsertRowid))!
  return newRepo
}

export function getRepoById(db: Database, id: number): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE id = ?')
  const row = stmt.get(id) as RepoRow | undefined
  
  return row ? rowToRepo(row) : null
}

export function getRepoByUrl(db: Database, repoUrl: string): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE repo_url = ?')
  const row = stmt.get(repoUrl) as RepoRow | undefined
  
  return row ? rowToRepo(row) : null
}

export function getRepoByUrlAndBranch(db: Database, repoUrl: string, branch?: string): Repo | null {
  const query = branch 
    ? 'SELECT * FROM repos WHERE repo_url = ? AND branch = ?'
    : 'SELECT * FROM repos WHERE repo_url = ? AND branch IS NULL'
  
  const stmt = db.prepare(query)
  const row = branch 
    ? stmt.get(repoUrl, branch) as RepoRow | undefined
    : stmt.get(repoUrl) as RepoRow | undefined
  
  return row ? rowToRepo(row) : null
}

export function listRepos(db: Database): Repo[] {
  const stmt = db.prepare('SELECT * FROM repos ORDER BY cloned_at DESC')
  const rows = stmt.all() as RepoRow[]
  
  return rows.map(rowToRepo)
}

export function updateRepoStatus(db: Database, id: number, cloneStatus: Repo['cloneStatus']): void {
  const stmt = db.prepare('UPDATE repos SET clone_status = ? WHERE id = ?')
  stmt.run(cloneStatus, id)
}

export function updateRepoConfigName(db: Database, id: number, configName: string): void {
  const stmt = db.prepare('UPDATE repos SET opencode_config_name = ? WHERE id = ?')
  stmt.run(configName, id)
}

export function updateLastPulled(db: Database, id: number): void {
  const stmt = db.prepare('UPDATE repos SET last_pulled = ? WHERE id = ?')
  stmt.run(Date.now(), id)
}

export function deleteRepo(db: Database, id: number): void {
  const stmt = db.prepare('DELETE FROM repos WHERE id = ?')
  stmt.run(id)
}
