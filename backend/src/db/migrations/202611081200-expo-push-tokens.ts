import type { Migration } from '../migration-runner'
import { ensureExpoPushTokensTable } from '../expo-push-tokens'

const migration: Migration = {
  id: '202611081200-expo-push-tokens',
  up(db) {
    ensureExpoPushTokensTable(db)
  },
  down(db) {
    db.run('DROP INDEX IF EXISTS idx_expo_push_tokens_user')
    db.run('DROP INDEX IF EXISTS idx_expo_push_tokens_session')
    db.run('DROP INDEX IF EXISTS idx_expo_push_receipts_check_after')
    db.run('DROP TABLE IF EXISTS expo_push_receipts')
    db.run('DROP TABLE IF EXISTS expo_push_tokens')
  },
}

export default migration
