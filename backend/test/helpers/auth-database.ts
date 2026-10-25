import { DatabaseSync } from 'node:sqlite'
import type { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

export function createAuthDatabase(): Database {
  const db = new DatabaseSync(':memory:')
  const compatible = Object.assign(db, {
    run: (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params),
  }) as unknown as Database
  migrate(compatible, allMigrations)
  return compatible
}
