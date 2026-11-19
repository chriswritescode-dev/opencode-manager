import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '023-schedule-mcp-servers',
  legacy: { version: 23, name: 'schedule-mcp-servers' },

  up(db) {
    const columns = selectTableColumns(db, 'schedule_jobs')
    if (!columns.some((column) => column.name === 'mcp_servers')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN mcp_servers TEXT')
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN mcp_servers')
  },
}

export default migration
