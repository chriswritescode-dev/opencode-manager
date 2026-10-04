import type { Migration } from '../migration-runner'
import { ensureSessionGoalsTable } from '../session-goals'

const migration: Migration = {
  version: 26,
  name: 'session-goals',
  up(db) {
    ensureSessionGoalsTable(db)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS session_goals')
  },
}

export default migration
