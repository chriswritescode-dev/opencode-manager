import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610151200-change-walkthrough-sessions',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(change_walkthroughs)').all() as Array<{ name: string }>
    if (columns.some((column) => column.name === 'generation_id')) {
      return
    }

    db.run('DROP TABLE IF EXISTS change_walkthroughs')
    db.run(`
      CREATE TABLE change_walkthroughs (
        session_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        diff_hash TEXT NOT NULL,
        generation_id TEXT NOT NULL,
        walkthrough_session_id TEXT,
        status TEXT NOT NULL,
        artifact_path TEXT,
        published_at INTEGER,
        error TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, source_key)
      )
    `)
    db.run('CREATE INDEX change_walkthroughs_walkthrough_session ON change_walkthroughs(walkthrough_session_id)')
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS change_walkthroughs')
  },
}

export default migration
