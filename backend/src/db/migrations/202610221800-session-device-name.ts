import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610221800-session-device-name',
  up(db) {
    const tableInfo = selectTableColumns(db, 'session')
    if (!tableInfo.some((column) => column.name === 'deviceName')) {
      db.run('ALTER TABLE "session" ADD COLUMN deviceName TEXT')
    }
  },
  down(db) {
    void db
  },
}

export default migration
