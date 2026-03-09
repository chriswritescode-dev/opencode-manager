import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 8,
  name: 'schedule-cron-support',

  up(db) {
    db.run('ALTER TABLE schedule_jobs ADD COLUMN schedule_mode TEXT')
    db.run('ALTER TABLE schedule_jobs ADD COLUMN cron_expression TEXT')
    db.run('ALTER TABLE schedule_jobs ADD COLUMN timezone TEXT')
    db.run("UPDATE schedule_jobs SET schedule_mode = 'interval' WHERE schedule_mode IS NULL")
  },

  down() {
  },
}

export default migration
