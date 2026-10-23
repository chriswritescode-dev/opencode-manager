import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  id: '202610221800-session-device-name',
  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info("session")').all() as ColumnInfo[]
    if (!tableInfo.some((column) => column.name === 'deviceName')) {
      db.run('ALTER TABLE "session" ADD COLUMN deviceName TEXT')
    }
  },
  down(db) {
    void db
  },
}

export default migration
