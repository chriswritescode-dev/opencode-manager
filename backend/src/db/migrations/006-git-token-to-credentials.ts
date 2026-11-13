import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'
import { z } from 'zod'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import { selectRows } from '../rows'

const PreferencesRowSchema = z.object({
  user_id: z.string(),
  preferences: z.string(),
})

const LegacyGitTokenPreferencesSchema = z.looseObject({
  gitToken: z.string().optional(),
  gitCredentials: z.array(JsonValueSchema).optional(),
})

const LegacyGitCredentialsPreferencesSchema = z.looseObject({
  gitCredentials: z.array(z.looseObject({ token: z.string() })).optional(),
})

const migration: Migration = {
  id: '006-git-token-to-credentials',
  legacy: { version: 6, name: 'git-token-to-credentials' },

  up(db) {
    const rows = selectRows(db, PreferencesRowSchema, 'SELECT user_id, preferences FROM user_preferences')

    for (const row of rows) {
      try {
        const parsed = LegacyGitTokenPreferencesSchema.parse(JSON.parse(row.preferences))
        const gitToken = parsed.gitToken
        const existingCredentials = parsed.gitCredentials

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
    const rows = selectRows(db, PreferencesRowSchema, 'SELECT user_id, preferences FROM user_preferences')

    for (const row of rows) {
      try {
        const parsed = LegacyGitCredentialsPreferencesSchema.parse(JSON.parse(row.preferences))
        const credentials = parsed.gitCredentials

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
