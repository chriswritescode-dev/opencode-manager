import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export interface StatementChanges {
  changes: number
  lastInsertRowid: number | bigint
}

export class Database extends DatabaseSync {
  private transactionDepth = 0

  constructor(path: string) {
    super(path)
    this.exec('PRAGMA foreign_keys = OFF')
  }

  run(sql: string, ...params: SQLInputValue[]): StatementChanges {
    const result = this.prepare(sql).run(...params)
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
  }

  query(sql: string) {
    return this.prepare(sql)
  }

  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args: Args) => {
      const nested = this.transactionDepth > 0
      const savepoint = `ocm_sp_${this.transactionDepth}`
      if (nested) {
        this.exec(`SAVEPOINT ${savepoint}`)
      } else {
        this.exec('BEGIN')
      }
      this.transactionDepth += 1
      try {
        const result = fn(...args)
        if (nested) {
          this.exec(`RELEASE ${savepoint}`)
        } else {
          this.exec('COMMIT')
        }
        return result
      } catch (error) {
        if (nested) {
          this.exec(`ROLLBACK TO ${savepoint}`)
          this.exec(`RELEASE ${savepoint}`)
        } else {
          this.exec('ROLLBACK')
        }
        throw error
      } finally {
        this.transactionDepth -= 1
      }
    }
  }
}
