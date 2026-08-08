import { DatabaseSync } from 'node:sqlite'

// Adapter to make node:sqlite compatible with bun:sqlite API
export class Database {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: unknown[]) => {
        const result = (stmt.run as (...args: unknown[]) => { changes: number; lastInsertRowid: number })(...params)
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
      },
      get: (...params: unknown[]) => (stmt.get as (...args: unknown[]) => unknown)(...params),
      all: (...params: unknown[]) => (stmt.all as (...args: unknown[]) => unknown[])(...params),
    }
  }

  query(sql: string) {
    return this.prepare(sql)
  }

  exec(sql: string) {
    this.db.exec(sql)
  }

  run(sql: string, ...params: unknown[]) {
    const stmt = this.db.prepare(sql)
    const result = (stmt.run as (...args: unknown[]) => { changes: number; lastInsertRowid: number })(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  transaction<T extends (...args: unknown[]) => void>(fn: T) {
    return (...args: unknown[]) => {
      this.db.exec('BEGIN')
      try {
        const result = fn(...args)
        this.db.exec('COMMIT')
        return result
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }
  }

  close() {
    this.db.close()
  }
}
