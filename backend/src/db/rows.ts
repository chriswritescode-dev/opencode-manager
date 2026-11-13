import type { Database, SQLQueryBindings } from 'bun:sqlite'
import { z } from 'zod'

export const TableColumnSchema = z.object({
  name: z.string(),
  notnull: z.number().default(0),
  dflt_value: z.string().nullable().default(null),
  pk: z.number().default(0),
})

export type TableColumn = z.infer<typeof TableColumnSchema>

export function selectRow<Schema extends z.ZodType>(
  db: Database,
  schema: Schema,
  sql: string,
  ...params: SQLQueryBindings[]
): z.infer<Schema> | null {
  const row = db.prepare<unknown, SQLQueryBindings[]>(sql).get(...params)
  return row === null || row === undefined ? null : schema.parse(row)
}

export function selectRows<Schema extends z.ZodType>(
  db: Database,
  schema: Schema,
  sql: string,
  ...params: SQLQueryBindings[]
): z.infer<Schema>[] {
  return db
    .prepare<unknown, SQLQueryBindings[]>(sql)
    .all(...params)
    .map((row) => schema.parse(row))
}

export function selectTableColumns(db: Database, table: string): TableColumn[] {
  return selectRows(db, TableColumnSchema, `PRAGMA table_info(${table})`)
}
