import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
}

const migration: Migration = {
  version: 2,
  name: 'repos-nullable-url',

  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info(repos)').all() as ColumnInfo[]
    const repoUrlColumn = tableInfo.find(col => col.name === 'repo_url')
    if (!repoUrlColumn || repoUrlColumn.notnull !== 1) return

    const existingColumns = tableInfo.map(col => col.name)

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

    const targetColumns = [
      'id', 'repo_url', 'local_path', 'branch', 'default_branch',
      'clone_status', 'cloned_at', 'last_pulled', 'opencode_config_name',
      'is_worktree', 'is_local'
    ]
    const columnsToCopy = targetColumns.filter(col => existingColumns.includes(col))
    const columnsStr = columnsToCopy.join(', ')

    db.run(`INSERT INTO repos_new (${columnsStr}) SELECT ${columnsStr} FROM repos`)
    db.run('DROP TABLE repos')
    db.run('ALTER TABLE repos_new RENAME TO repos')
    db.run('CREATE INDEX IF NOT EXISTS idx_repo_clone_status ON repos(clone_status)')
  },

  down(db) {
    const tableInfo = db.prepare('PRAGMA table_info(repos)').all() as ColumnInfo[]
    const existingColumns = tableInfo.map(col => col.name)

    db.run(`
      CREATE TABLE repos_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT NOT NULL,
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

    const targetColumns = [
      'id', 'repo_url', 'local_path', 'branch', 'default_branch',
      'clone_status', 'cloned_at', 'last_pulled', 'opencode_config_name',
      'is_worktree', 'is_local'
    ]
    const columnsToCopy = targetColumns.filter(col => existingColumns.includes(col))
    const columnsStr = columnsToCopy.join(', ')

    db.run(`INSERT INTO repos_old (${columnsStr}) SELECT ${columnsStr} FROM repos WHERE repo_url IS NOT NULL`)
    db.run('DROP TABLE repos')
    db.run('ALTER TABLE repos_old RENAME TO repos')
    db.run('CREATE INDEX IF NOT EXISTS idx_repo_clone_status ON repos(clone_status)')
  },
}

export default migration
