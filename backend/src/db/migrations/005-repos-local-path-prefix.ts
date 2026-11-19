import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'
import { z } from 'zod'
import { selectRows } from '../rows'

const RepoLocalPathRowSchema = z.object({
  id: z.number(),
  local_path: z.string(),
})

const migration: Migration = {
  id: '005-repos-local-path-prefix',
  legacy: { version: 5, name: 'repos-local-path-prefix' },

  up(db) {
    const repos = selectRows(
      db,
      RepoLocalPathRowSchema,
      "SELECT id, local_path FROM repos WHERE local_path LIKE 'repos/%'",
    )

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
