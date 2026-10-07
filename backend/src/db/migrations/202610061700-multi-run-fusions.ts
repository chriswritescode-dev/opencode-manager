import type { Migration } from '../migration-runner'
import { ensureMultiRunFusionTable } from '../multi-runs'

const migration: Migration = {
  id: '202610061700-multi-run-fusions',
  up(db) {
    ensureMultiRunFusionTable(db)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS multi_run_fusions')
  },
}

export default migration
