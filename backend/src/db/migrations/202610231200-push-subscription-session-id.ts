import type { Migration } from '../migration-runner'
import { ensurePushSubscriptionsTable } from '../../db/push-subscriptions'

const migration: Migration = {
  id: '202610231200-push-subscription-session-id',
  up(db) {
    ensurePushSubscriptionsTable(db)
  },
  down(db) {
    void db
  },
}

export default migration
