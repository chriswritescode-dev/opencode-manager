import type { Database } from 'bun:sqlite'
import {
  RemoteAccessHeaderListSchema,
  type RemoteAccessHeader,
  type RemoteAccessHeadersResponse,
  type RemoteAccessHeaderSummary,
  type ReplaceRemoteAccessHeadersRequest,
} from '@opencode-manager/shared/schemas'
import { deleteSecret, hasSecret, readEncryptedSecret, writeEncryptedSecret } from '../db/secrets'
import { logger } from '../utils/logger'
import { ServiceError } from '../utils/service-error'

export const REMOTE_ACCESS_HEADERS_SECRET_KEY = 'remote_access_headers'

export class RemoteAccessHeadersError extends ServiceError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'RemoteAccessHeadersError'
  }
}

export interface StoredRemoteAccessHeaders {
  headers: RemoteAccessHeader[]
  unreadable: boolean
}

function parseStoredHeaders(value: string): RemoteAccessHeader[] | null {
  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(value)
  } catch {
    return null
  }

  const parsed = RemoteAccessHeaderListSchema.safeParse(parsedValue)
  return parsed.success ? parsed.data : null
}

function summarize(headers: RemoteAccessHeader[]): RemoteAccessHeaderSummary[] {
  return headers.map((header) => ({ name: header.name, hasValue: true }))
}

export class RemoteAccessHeadersService {
  constructor(private db: Database) {}

  read(): StoredRemoteAccessHeaders {
    const stored = readEncryptedSecret(this.db, REMOTE_ACCESS_HEADERS_SECRET_KEY)
    if (stored === null) {
      return { headers: [], unreadable: hasSecret(this.db, REMOTE_ACCESS_HEADERS_SECRET_KEY) }
    }

    const headers = parseStoredHeaders(stored)
    if (headers !== null) {
      return { headers, unreadable: false }
    }

    logger.warn('Stored remote access headers could not be read')
    return { headers: [], unreadable: true }
  }

  getSummary(): RemoteAccessHeadersResponse {
    const { headers, unreadable } = this.read()
    return { headers: summarize(headers), unreadable }
  }

  replace(request: ReplaceRemoteAccessHeadersRequest): RemoteAccessHeadersResponse {
    const stored = this.read().headers

    const merged = request.headers.map((entry) => {
      const value = entry.value?.trim()
      if (value) {
        return { name: entry.name, value }
      }

      const existing = stored.find((header) => header.name.toLowerCase() === entry.name.toLowerCase())
      if (!existing) {
        throw new RemoteAccessHeadersError(`A value is required for ${entry.name}`, 400)
      }
      return { name: entry.name, value: existing.value }
    })

    const validated = RemoteAccessHeaderListSchema.safeParse(merged)
    if (!validated.success) {
      throw new RemoteAccessHeadersError(
        validated.error.issues.map((issue) => issue.message).join('; '),
        400,
      )
    }

    const headers = validated.data
    if (headers.length === 0) {
      deleteSecret(this.db, REMOTE_ACCESS_HEADERS_SECRET_KEY)
    } else {
      writeEncryptedSecret(this.db, REMOTE_ACCESS_HEADERS_SECRET_KEY, JSON.stringify(headers))
    }

    logger.info(`Updated remote access headers (${headers.length} headers)`)
    return { headers: summarize(headers), unreadable: false }
  }

  clear(): void {
    deleteSecret(this.db, REMOTE_ACCESS_HEADERS_SECRET_KEY)
  }
}
