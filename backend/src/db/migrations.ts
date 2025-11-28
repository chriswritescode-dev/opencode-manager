import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export function runMigrations(db: Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(repos)").all() as any[]
    
    const repoUrlColumn = tableInfo.find((col: any) => col.name === 'repo_url')
    if (repoUrlColumn && repoUrlColumn.notnull === 1) {
      logger.info('Migrating repos table to allow nullable repo_url for local repos')
      db.run('BEGIN TRANSACTION')
      try {
        db.run(`
          CREATE TABLE repos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_url TEXT,
            local_path TEXT NOT NULL,
            branch TEXT,
            default_branch TEXT,
            clone_status TEXT NOT NULL,
            cloned_at INTEGER NOT NULL,
            last_pulled INTEGER,
            opencode_config_name TEXT,
            is_worktree BOOLEAN DEFAULT FALSE,
            is_local BOOLEAN DEFAULT FALSE
          )
        `)
        db.run(`
          INSERT INTO repos_new (id, repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_pulled, opencode_config_name, is_worktree, is_local)
          SELECT id, repo_url, local_path, branch, default_branch, clone_status, cloned_at, last_pulled, opencode_config_name, is_worktree, is_local FROM repos
        `)
        db.run('DROP TABLE repos')
        db.run('ALTER TABLE repos_new RENAME TO repos')
        db.run('COMMIT')
        logger.info('Successfully migrated repos table to allow nullable repo_url')
      } catch (migrationError) {
        db.run('ROLLBACK')
        throw migrationError
      }
    }
    
    const hasBranchColumn = tableInfo.some(col => col.name === 'branch')
    
    if (!hasBranchColumn) {
      logger.info('Adding missing branch column to repos table')
      db.run('ALTER TABLE repos ADD COLUMN branch TEXT')
    }
    
    try {
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_url_branch 
        ON repos(repo_url, branch) 
        WHERE branch IS NOT NULL
      `)
    } catch (error) {
      logger.debug('Index already exists or could not be created', error)
    }
    
    try {
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_local_path 
        ON repos(local_path)
      `)
    } catch (error) {
      logger.debug('Local path index already exists or could not be created', error)
    }
    
    const requiredColumns = [
      { name: 'default_branch', sql: 'ALTER TABLE repos ADD COLUMN default_branch TEXT' },
      { name: 'clone_status', sql: 'ALTER TABLE repos ADD COLUMN clone_status TEXT NOT NULL DEFAULT "cloning"' },
      { name: 'cloned_at', sql: 'ALTER TABLE repos ADD COLUMN cloned_at INTEGER NOT NULL DEFAULT 0' },
      { name: 'last_pulled', sql: 'ALTER TABLE repos ADD COLUMN last_pulled INTEGER' },
      { name: 'opencode_config_name', sql: 'ALTER TABLE repos ADD COLUMN opencode_config_name TEXT' },
      { name: 'is_worktree', sql: 'ALTER TABLE repos ADD COLUMN is_worktree BOOLEAN DEFAULT FALSE' },
      { name: 'is_local', sql: 'ALTER TABLE repos ADD COLUMN is_local BOOLEAN DEFAULT FALSE' }
    ]
    
    for (const column of requiredColumns) {
      const hasColumn = tableInfo.some(col => col.name === column.name)
      if (!hasColumn) {
        logger.info(`Adding missing column: ${column.name}`)
        try {
          db.run(column.sql)
        } catch (error) {
          logger.debug(`Column ${column.name} might already exist:`, error)
        }
      }
    }
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_repo_clone_status ON repos(clone_status)',
      'CREATE INDEX IF NOT EXISTS idx_user_id ON user_preferences(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_opencode_user_id ON opencode_configs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_opencode_default ON opencode_configs(user_id, is_default)'
    ]
    
    for (const indexSql of indexes) {
      try {
        db.run(indexSql)
      } catch (error) {
        logger.debug('Index already exists:', error)
      }
    }
    
    try {
      const repos = db.prepare("SELECT id, local_path FROM repos WHERE local_path LIKE 'repos/%'").all() as any[]
      if (repos.length > 0) {
        logger.info(`Migrating ${repos.length} repos to remove 'repos/' prefix from local_path`)
        const updateStmt = db.prepare("UPDATE repos SET local_path = ? WHERE id = ?")
        for (const repo of repos) {
          const newPath = repo.local_path.replace(/^repos\//, '')
          updateStmt.run(newPath, repo.id)
          logger.info(`Updated repo ${repo.id}: ${repo.local_path} -> ${newPath}`)
        }
      }
    } catch (error) {
      logger.error('Failed to migrate local_path format:', error)
    }
    
    logger.info('Database migrations completed successfully')
  } catch (error) {
    logger.error('Failed to run database migrations:', error)
    throw error
  }
}
