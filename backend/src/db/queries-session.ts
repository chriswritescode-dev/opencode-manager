import type { Database } from 'bun:sqlite'
import type { 
  Session, 
  SessionStatus, 
  RepoMapping,
  DevcontainerTemplate,
  DevcontainerConfig,
} from '@opencode-manager/shared'

interface SessionRow {
  id: string
  name: string
  status: SessionStatus
  opencode_container_id: string | null
  dind_container_id: string | null
  code_server_container_id: string | null
  internal_hostname: string
  opencode_url: string
  code_server_url: string
  public_opencode_url: string | null
  session_path: string
  opencode_state_path: string
  dind_data_path: string
  code_server_config_path: string
  devcontainer_template: string
  devcontainer_config_hash: string
  created_at: number
  last_active_at: number
  metadata: string | null
}

interface SessionRepoRow {
  id: number
  session_id: string
  repo_id: number
  repo_name: string
  worktree_path: string
  symlink_path: string
  container_path: string
  branch: string | null
}

interface DevcontainerTemplateRow {
  name: string
  config: string
  dockerfile: string | null
  forked_from: string | null
  is_built_in: number
  created_at: number
  updated_at: number
  metadata: string | null
}

function rowToSession(row: SessionRow, repoMappings: RepoMapping[]): Session {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    repoMappings,
    opencodeContainerId: row.opencode_container_id,
    dindContainerId: row.dind_container_id,
    codeServerContainerId: row.code_server_container_id,
    internalHostname: row.internal_hostname,
    opencodeUrl: row.opencode_url,
    codeServerUrl: row.code_server_url,
    publicOpencodeUrl: row.public_opencode_url || undefined,
    sessionPath: row.session_path,
    opencodeStatePath: row.opencode_state_path,
    dindDataPath: row.dind_data_path,
    codeServerConfigPath: row.code_server_config_path,
    devcontainerTemplate: row.devcontainer_template,
    devcontainerConfigHash: row.devcontainer_config_hash,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  }
}

function rowToDevcontainerTemplate(row: DevcontainerTemplateRow): DevcontainerTemplate {
  return {
    name: row.name,
    config: JSON.parse(row.config) as DevcontainerConfig,
    dockerfile: row.dockerfile || undefined,
    forkedFrom: row.forked_from || undefined,
    isBuiltIn: Boolean(row.is_built_in),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }
}

export function createSession(db: Database, session: Session): Session {
  db.prepare(`
    INSERT INTO sessions (
      id, name, status,
      opencode_container_id, dind_container_id, code_server_container_id,
      internal_hostname, opencode_url, code_server_url, public_opencode_url,
      session_path, opencode_state_path, dind_data_path, code_server_config_path,
      devcontainer_template, devcontainer_config_hash,
      created_at, last_active_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.name,
    session.status,
    session.opencodeContainerId,
    session.dindContainerId,
    session.codeServerContainerId,
    session.internalHostname,
    session.opencodeUrl,
    session.codeServerUrl,
    session.publicOpencodeUrl || null,
    session.sessionPath,
    session.opencodeStatePath,
    session.dindDataPath,
    session.codeServerConfigPath,
    session.devcontainerTemplate,
    session.devcontainerConfigHash,
    session.createdAt,
    session.lastActiveAt,
    JSON.stringify(session.metadata)
  )

  for (const mapping of session.repoMappings) {
    db.prepare(`
      INSERT INTO session_repos (
        session_id, repo_id, repo_name, worktree_path, symlink_path, container_path, branch
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      mapping.repoId,
      mapping.repoName,
      mapping.worktreePath,
      mapping.symlinkPath,
      mapping.containerPath,
      mapping.branch || null
    )
  }

  return session
}

export function getSessionById(db: Database, sessionId: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
  if (!row) return null

  const repoRows = db.prepare('SELECT * FROM session_repos WHERE session_id = ?').all(sessionId) as SessionRepoRow[]
  const repoMappings: RepoMapping[] = repoRows.map(r => ({
    repoId: r.repo_id,
    repoName: r.repo_name,
    worktreePath: r.worktree_path,
    symlinkPath: r.symlink_path,
    containerPath: r.container_path,
    branch: r.branch || undefined,
  }))

  return rowToSession(row, repoMappings)
}

export function getSessionByName(db: Database, name: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE name = ?').get(name) as SessionRow | undefined
  if (!row) return null

  const repoRows = db.prepare('SELECT * FROM session_repos WHERE session_id = ?').all(row.id) as SessionRepoRow[]
  const repoMappings: RepoMapping[] = repoRows.map(r => ({
    repoId: r.repo_id,
    repoName: r.repo_name,
    worktreePath: r.worktree_path,
    symlinkPath: r.symlink_path,
    containerPath: r.container_path,
    branch: r.branch || undefined,
  }))

  return rowToSession(row, repoMappings)
}

export function getAllSessions(db: Database): Session[] {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY last_active_at DESC').all() as SessionRow[]
  
  return rows.map(row => {
    const repoRows = db.prepare('SELECT * FROM session_repos WHERE session_id = ?').all(row.id) as SessionRepoRow[]
    const repoMappings: RepoMapping[] = repoRows.map(r => ({
      repoId: r.repo_id,
      repoName: r.repo_name,
      worktreePath: r.worktree_path,
      symlinkPath: r.symlink_path,
      containerPath: r.container_path,
      branch: r.branch || undefined,
    }))
    return rowToSession(row, repoMappings)
  })
}

export function getSessionsByStatus(db: Database, status: SessionStatus): Session[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY last_active_at DESC').all(status) as SessionRow[]
  
  return rows.map(row => {
    const repoRows = db.prepare('SELECT * FROM session_repos WHERE session_id = ?').all(row.id) as SessionRepoRow[]
    const repoMappings: RepoMapping[] = repoRows.map(r => ({
      repoId: r.repo_id,
      repoName: r.repo_name,
      worktreePath: r.worktree_path,
      symlinkPath: r.symlink_path,
      containerPath: r.container_path,
      branch: r.branch || undefined,
    }))
    return rowToSession(row, repoMappings)
  })
}

export function updateSessionStatus(db: Database, sessionId: string, status: SessionStatus): void {
  db.prepare('UPDATE sessions SET status = ?, last_active_at = ? WHERE id = ?')
    .run(status, Date.now(), sessionId)
}

export function updateSessionContainerIds(
  db: Database, 
  sessionId: string, 
  containerIds: {
    opencode?: string
    dind?: string
    codeServer?: string
  }
): void {
  const updates: string[] = []
  const values: any[] = []

  if (containerIds.opencode !== undefined) {
    updates.push('opencode_container_id = ?')
    values.push(containerIds.opencode)
  }
  if (containerIds.dind !== undefined) {
    updates.push('dind_container_id = ?')
    values.push(containerIds.dind)
  }
  if (containerIds.codeServer !== undefined) {
    updates.push('code_server_container_id = ?')
    values.push(containerIds.codeServer)
  }

  if (updates.length > 0) {
    values.push(Date.now())
    values.push(sessionId)
    db.prepare(`UPDATE sessions SET ${updates.join(', ')}, last_active_at = ? WHERE id = ?`)
      .run(...values)
  }
}

export function deleteSession(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

export function createDevcontainerTemplate(db: Database, template: DevcontainerTemplate): DevcontainerTemplate {
  db.prepare(`
    INSERT INTO devcontainer_templates (
      name, config, dockerfile, forked_from, is_built_in, created_at, updated_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    template.name,
    JSON.stringify(template.config),
    template.dockerfile || null,
    template.forkedFrom || null,
    template.isBuiltIn ? 1 : 0,
    template.createdAt,
    template.updatedAt,
    template.metadata ? JSON.stringify(template.metadata) : null
  )

  return template
}

export function getDevcontainerTemplate(db: Database, name: string): DevcontainerTemplate | null {
  const row = db.prepare('SELECT * FROM devcontainer_templates WHERE name = ?').get(name) as DevcontainerTemplateRow | undefined
  return row ? rowToDevcontainerTemplate(row) : null
}

export function getAllDevcontainerTemplates(db: Database): DevcontainerTemplate[] {
  const rows = db.prepare('SELECT * FROM devcontainer_templates ORDER BY name').all() as DevcontainerTemplateRow[]
  return rows.map(rowToDevcontainerTemplate)
}

export function updateDevcontainerTemplate(db: Database, name: string, config: DevcontainerConfig): void {
  db.prepare('UPDATE devcontainer_templates SET config = ?, updated_at = ? WHERE name = ?')
    .run(JSON.stringify(config), Date.now(), name)
}

export function deleteDevcontainerTemplate(db: Database, name: string): void {
  db.prepare('DELETE FROM devcontainer_templates WHERE name = ?').run(name)
}

export function getSessionsByTemplate(db: Database, templateName: string): Session[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE devcontainer_template = ?').all(templateName) as SessionRow[]
  
  return rows.map(row => {
    const repoRows = db.prepare('SELECT * FROM session_repos WHERE session_id = ?').all(row.id) as SessionRepoRow[]
    const repoMappings: RepoMapping[] = repoRows.map(r => ({
      repoId: r.repo_id,
      repoName: r.repo_name,
      worktreePath: r.worktree_path,
      symlinkPath: r.symlink_path,
      containerPath: r.container_path,
      branch: r.branch || undefined,
    }))
    return rowToSession(row, repoMappings)
  })
}
