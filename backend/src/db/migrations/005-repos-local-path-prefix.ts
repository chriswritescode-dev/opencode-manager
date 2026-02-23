import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'

const migration: Migration = {
  version: 5,
  name: 'repos-local-path-prefix',

  up(db) {
    const repos = db.prepare("SELECT id, local_path FROM repos WHERE local_path LIKE 'repos/%'").all() as Array<{
      id: number
      local_path: string
    }>

    if (repos.length === 0) return

    logger.info(`Stripping 'repos/' prefix from ${repos.length} repo local_path(s)`)
    const stmt = db.prepare('UPDATE repos SET local_path = ? WHERE id = ?')
    for (const repo of repos) {
      stmt.run(repo.local_path.replace(/^repos\//, ''), repo.id)
    }
  },

  down(db) {
    void db
  },
}

export default migration
