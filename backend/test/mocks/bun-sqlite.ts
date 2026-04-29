import DatabaseImpl from 'better-sqlite3'
import type { Database as BetterSqlite3Database } from 'better-sqlite3'

// Adapter to make better-sqlite3 compatible with bun:sqlite API
export class Database {
  private db: BetterSqlite3Database

  constructor(path: string) {
    this.db = new DatabaseImpl(path)
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: unknown[]) => stmt.run(...params),
      get: (...params: unknown[]) => stmt.get(...params),
      all: (...params: unknown[]) => stmt.all(...params),
    }
  }

  exec(sql: string) {
    this.db.exec(sql)
  }

  run(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).run(...params)
  }

  transaction<T extends (...args: unknown[]) => void>(fn: T) {
    return this.db.transaction(fn)
  }

  close() {
    this.db.close()
  }
}
