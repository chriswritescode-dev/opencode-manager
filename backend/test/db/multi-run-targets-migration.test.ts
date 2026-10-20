import { afterEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import migration from '../../src/db/migrations/202610181310-multi-run-targets'
import { ensureMultiRunTables } from '../../src/db/multi-runs'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

function createLegacyTable(db: Database): void {
  db.run(`
    CREATE TABLE multi_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      isolated INTEGER NOT NULL,
      base_ref TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.run('CREATE INDEX idx_multi_runs_repo ON multi_runs(repo_id, created_at DESC)')
}

function columns(db: Database): ColumnInfo[] {
  return db.prepare('PRAGMA table_info(multi_runs)').all() as ColumnInfo[]
}

describe('202610181310-multi-run-targets migration', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('makes repo_id nullable and adds the server target columns', () => {
    db = new Database(':memory:')
    createLegacyTable(db)

    migration.up(db)

    const byName = new Map(columns(db).map((column) => [column.name, column]))
    expect(byName.get('repo_id')?.notnull).toBe(0)
    expect(byName.get('server_id')).toMatchObject({ notnull: 1, dflt_value: "'local'" })
    expect(byName.has('directory')).toBe(true)
  })

  it('preserves existing rows and their ids', () => {
    db = new Database(':memory:')
    createLegacyTable(db)
    db.run(
      `INSERT INTO multi_runs(id, repo_id, name, prompt, isolated, base_ref, created_at)
       VALUES(7, 3, 'Sweep', 'go', 1, 'main', 1700000000000)`,
    )

    migration.up(db)

    expect(
      db.prepare('SELECT id, repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at FROM multi_runs').get(),
    ).toEqual({
      id: 7,
      repo_id: 3,
      server_id: 'local',
      directory: null,
      name: 'Sweep',
      prompt: 'go',
      isolated: 1,
      base_ref: 'main',
      created_at: 1700000000000,
    })
  })

  it('recreates the repo and server indexes', () => {
    db = new Database(':memory:')
    createLegacyTable(db)

    migration.up(db)

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'multi_runs'").all() as Array<{
        name: string
      }>
    ).map((index) => index.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_multi_runs_repo', 'idx_multi_runs_server']))
  })

  it('is idempotent', () => {
    db = new Database(':memory:')
    createLegacyTable(db)
    db.run(
      `INSERT INTO multi_runs(id, repo_id, name, prompt, isolated, base_ref, created_at)
       VALUES(1, 2, 'Sweep', 'go', 0, NULL, 1)`,
    )

    migration.up(db)
    migration.up(db)

    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_runs').get()).toEqual({ count: 1 })
    expect(columns(db).filter((column) => column.name === 'server_id')).toHaveLength(1)
  })

  it('skips a table that already has the new schema', () => {
    db = new Database(':memory:')
    ensureMultiRunTables(db)
    db.run(
      `INSERT INTO multi_runs(id, repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at)
       VALUES(4, NULL, 'srv_kitchen', '/srv/app', 'Remote sweep', 'go', 1, NULL, 2)`,
    )

    migration.up(db)

    expect(db.prepare('SELECT id, repo_id, server_id, directory FROM multi_runs').get()).toEqual({
      id: 4,
      repo_id: null,
      server_id: 'srv_kitchen',
      directory: '/srv/app',
    })
  })

  it('drops remote rows and restores the repo-only schema on down', () => {
    db = new Database(':memory:')
    ensureMultiRunTables(db)
    db.run(
      `INSERT INTO multi_runs(id, repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at)
       VALUES(1, 5, 'local', NULL, 'Local', 'go', 0, NULL, 1),
              (2, NULL, 'srv_kitchen', '/srv/app', 'Remote', 'go', 0, NULL, 2)`,
    )

    migration.down(db)

    expect(db.prepare('SELECT id, repo_id FROM multi_runs').all()).toEqual([{ id: 1, repo_id: 5 }])
    expect(columns(db).map((column) => column.name)).toEqual([
      'id',
      'repo_id',
      'name',
      'prompt',
      'isolated',
      'base_ref',
      'created_at',
    ])
  })
})
