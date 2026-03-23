import { DatabaseSync } from 'node:sqlite'

export class Database {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = OFF')
  }

  prepare(sql: string) {
    return this.db.prepare(sql)
  }

  exec(sql: string) {
    return this.db.exec(sql)
  }

  run(sql: string) {
    return this.db.exec(sql)
  }

  close() {
    this.db.close()
  }
}
