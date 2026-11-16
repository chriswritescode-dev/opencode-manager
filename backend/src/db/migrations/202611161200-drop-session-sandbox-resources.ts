import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202611161200-drop-session-sandbox-resources',

  up(db) {
    const cols = selectTableColumns(db, 'session_sandbox_modes')
    for (const name of ['cpus', 'memory_mib']) {
      if (cols.some((c) => c.name === name)) {
        db.run(`ALTER TABLE session_sandbox_modes DROP COLUMN ${name}`)
      }
    }
  },

  down(_db) {
    void _db
  },
}

export default migration
