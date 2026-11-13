import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610081200-change-walkthrough-sources',
  up(db) {
    const columns = selectTableColumns(db, 'change_walkthroughs')
    if (columns.some((column) => column.name === 'source_key')) {
      return
    }

    db.run('DROP TABLE IF EXISTS change_walkthroughs')
    db.run(`
      CREATE TABLE change_walkthroughs (
        session_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        diff_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, source_key)
      )
    `)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS change_walkthroughs')
  },
}

export default migration
