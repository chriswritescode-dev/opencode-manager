import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'

const migration: Migration = {
  version: 6,
  name: 'git-token-to-credentials',

  up(db) {
    const rows = db.prepare('SELECT user_id, preferences FROM user_preferences').all() as Array<{
      user_id: string
      preferences: string
    }>

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.preferences) as Record<string, unknown>
        const gitToken = parsed.gitToken as string | undefined
        const existingCredentials = parsed.gitCredentials as Array<unknown> | undefined

        if (!gitToken) continue
        if (existingCredentials && existingCredentials.length > 0) continue

        const { gitToken: _, ...rest } = parsed
        void _
        const migrated = {
          ...rest,
          gitCredentials: [{
            name: 'GitHub',
            host: 'https://github.com/',
            token: gitToken,
          }],
        }

        db.prepare('UPDATE user_preferences SET preferences = ? WHERE user_id = ?')
          .run(JSON.stringify(migrated), row.user_id)

        logger.info(`Migrated gitToken to gitCredentials for user: ${row.user_id}`)
      } catch (parseError) {
        logger.error(`Failed to parse preferences for user ${row.user_id}:`, parseError)
      }
    }
  },

  down(db) {
    const rows = db.prepare('SELECT user_id, preferences FROM user_preferences').all() as Array<{
      user_id: string
      preferences: string
    }>

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.preferences) as Record<string, unknown>
        const credentials = parsed.gitCredentials as Array<{ token: string }> | undefined

        const firstCredential = credentials?.[0]
        if (!firstCredential) continue

        const { gitCredentials: _, ...rest } = parsed
        void _
        const reverted = {
          ...rest,
          gitToken: firstCredential.token,
        }

        db.prepare('UPDATE user_preferences SET preferences = ? WHERE user_id = ?')
          .run(JSON.stringify(reverted), row.user_id)
      } catch (parseError) {
        logger.error(`Failed to revert preferences for user ${row.user_id}:`, parseError)
      }
    }
  },
}

export default migration
