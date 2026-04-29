import type { Migration } from '../migration-runner'
import { ensureOpenCodeModelStateTable } from '../model-state'

const migration: Migration = {
  version: 12,
  name: 'opencode-model-state',
  up(db) {
    ensureOpenCodeModelStateTable(db)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS opencode_model_state')
  },
}

export default migration
