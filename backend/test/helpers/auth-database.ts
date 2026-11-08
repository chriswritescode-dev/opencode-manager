import { DatabaseSync } from 'node:sqlite'
import type { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

export function createAuthDatabase(): Database {
  const db = new DatabaseSync(':memory:')
  let transactionDepth = 0
  const compatible = Object.assign(db, {
    run: (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params),
    transaction: <T extends (...args: unknown[]) => void>(fn: T) => (...args: unknown[]) => {
      const nested = transactionDepth > 0
      const savepoint = `auth_sp_${transactionDepth}`
      db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN')
      transactionDepth += 1
      try {
        const result = fn(...args)
        db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT')
        return result
      } catch (error) {
        if (nested) {
          db.exec(`ROLLBACK TO ${savepoint}`)
          db.exec(`RELEASE ${savepoint}`)
        } else {
          db.exec('ROLLBACK')
        }
        throw error
      } finally {
        transactionDepth -= 1
      }
    },
  }) as unknown as Database
  migrate(compatible, allMigrations)
  return compatible
}
