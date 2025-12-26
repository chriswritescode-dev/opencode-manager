import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { getReposPath } from '@opencode-manager/shared/config/env'
import path from 'path'

export interface RepoRow {
  id: number
  repo_url?: string
  local_path: string
  branch?: string
  default_branch: string
  clone_status: string
  cloned_at: number
  last_pulled?: number
  opencode_config_name?: string
  is_worktree?: number
  is_local?: number
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
    isLocal: row.is_local ? Boolean(row.is_local) : undefined,
  }
}

export function createRepo(db: Database, repo: CreateRepoInput): Repo {
  const normalizedPath = repo.localPath.trim().replace(/\/+$/, '')
  
  const existing = repo.isLocal 
    ? getRepoByLocalPath(db, normalizedPath)
    : getRepoByUrlAndBranch(db, repo.repoUrl!, repo.branch)
  
  if (existing) {
    return existing
  }
  
  const stmt = db.prepare(`
    INSERT INTO repos (repo_url, local_path, branch, default_branch, clone_status, cloned_at, is_worktree, is_local)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  try {
    const result = stmt.run(
      repo.repoUrl || null,
      normalizedPath,
      repo.branch || null,
      repo.defaultBranch,
      repo.cloneStatus,
      repo.clonedAt,
      repo.isWorktree ? 1 : 0,
      repo.isLocal ? 1 : 0
    )
    
    const newRepo = getRepoById(db, Number(result.lastInsertRowid))
    if (!newRepo) {
      throw new Error(`Failed to retrieve newly created repo with id ${result.lastInsertRowid}`)
    }
    return newRepo
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed') || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const conflictRepo = repo.isLocal 
        ? getRepoByLocalPath(db, normalizedPath)
        : getRepoByUrlAndBranch(db, repo.repoUrl!, repo.branch)
      
      if (conflictRepo) {
        return conflictRepo
      }
      
      const identifier = repo.isLocal ? `path '${normalizedPath}'` : `url '${repo.repoUrl}' branch '${repo.branch || 'default'}'`
      throw new Error(`Repository with ${identifier} already exists but could not be retrieved. This may indicate database corruption.`)
    }
    
    throw new Error(`Failed to create repository: ${error.message}`)
  }
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

export function getRepoByLocalPath(db: Database, localPath: string): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE local_path = ?')
  const row = stmt.get(localPath) as RepoRow | undefined
  
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
