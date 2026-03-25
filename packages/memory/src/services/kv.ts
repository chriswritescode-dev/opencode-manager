import type { Database } from 'bun:sqlite'
import { createKvQuery } from '../storage/kv-queries'
import type { Logger } from '../types'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface KvEntry {
  key: string
  data: unknown
  updatedAt: number
  expiresAt: number
}

export interface KvService {
  get<T = unknown>(projectId: string, key: string): T | null
  set<T = unknown>(projectId: string, key: string, data: T, ttlMs?: number): void
  delete(projectId: string, key: string): void
  list(projectId: string): KvEntry[]
  listByPrefix(projectId: string, prefix: string): KvEntry[]
}

export function createKvService(db: Database, logger?: Logger, defaultTtlMs?: number): KvService {
  const queries = createKvQuery(db)

  return {
    get<T = unknown>(projectId: string, key: string): T | null {
      const row = queries.get(projectId, key)
      if (!row) return null
      try {
        return JSON.parse(row.data) as T
      } catch {
        return null
      }
    },

    set<T = unknown>(projectId: string, key: string, data: T, ttlMs?: number): void {
      const expiresAt = Date.now() + (ttlMs ?? defaultTtlMs ?? DEFAULT_TTL_MS)
      const jsonData = JSON.stringify(data)
      queries.set(projectId, key, jsonData, expiresAt)
    },

    delete(projectId: string, key: string): void {
      queries.delete(projectId, key)
    },

    list(projectId: string): KvEntry[] {
      const rows = queries.list(projectId)
      return rows.map((row) => {
        let data: unknown = null
        try {
          data = JSON.parse(row.data)
        } catch {
        }
        return {
          key: row.key,
          data,
          updatedAt: row.updatedAt,
          expiresAt: row.expiresAt,
        }
      })
    },

    listByPrefix(projectId: string, prefix: string): KvEntry[] {
      const rows = queries.listByPrefix(projectId, prefix)
      return rows.map((row) => {
        let data: unknown = null
        try {
          data = JSON.parse(row.data)
        } catch {
        }
        return {
          key: row.key,
          data,
          updatedAt: row.updatedAt,
          expiresAt: row.expiresAt,
        }
      })
    },
  }
}
