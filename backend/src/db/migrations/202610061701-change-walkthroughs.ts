import type { Migration } from '../migration-runner'
import { ensureChangeWalkthroughTable } from '../change-walkthroughs'

const migration: Migration = {
  id: '202610061701-change-walkthroughs',
  up(db) {
    ensureChangeWalkthroughTable(db)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS change_walkthroughs')
  },
}

export default migration
