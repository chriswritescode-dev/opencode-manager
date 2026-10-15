import type { Migration } from '../migration-runner'
import { ensureSessionSandboxModesTable } from '../session-sandbox-modes'

const migration: Migration = {
  id: '202610141200-session-sandbox-modes',
  up(db) {
    ensureSessionSandboxModesTable(db)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS session_sandbox_modes')
  },
}

export default migration
