import type { TranscriptCache } from '@/lib/session-projection'

export const OFFLINE_TRANSCRIPT_LIMIT = 10
export const OFFLINE_TRANSCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DATABASE_NAME = 'ocm-offline-transcripts'
const DATABASE_VERSION = 2
const SNAPSHOT_STORE_NAME = 'snapshots'
const META_STORE_NAME = 'meta'
const KEY_PREFIX = 'ocm.transcript.v1:'

interface OfflineTranscriptRecord {
  key: string
  owner: string
  serverId: string
  sessionId: string
  savedAt: number
  openedAt: number
  cache: TranscriptCache
}

interface OfflineTranscriptMeta {
  key: string
  owner: string
  openedAt: number
}

interface OfflineTranscriptStores {
  snapshots: IDBObjectStore
  meta: IDBObjectStore
}

interface OfflineTranscriptTarget {
  owner: string
  serverId: string
  sessionId: string
}

interface SaveOfflineTranscriptInput extends OfflineTranscriptTarget {
  cache: TranscriptCache
  now?: number
}

interface LoadOfflineTranscriptInput extends OfflineTranscriptTarget {
  now?: number
}

interface MarkOfflineTranscriptOpenedInput extends OfflineTranscriptTarget {
  now?: number
}

function transcriptKey(target: OfflineTranscriptTarget): string {
  return `${KEY_PREFIX}${target.owner}:${target.serverId}:${target.sessionId}`
}

function ownerKeyPrefix(owner: string): string {
  return `${KEY_PREFIX}${owner}:`
}

function prefixedKeyRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`)
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Identifies the transcripts stored for the current app build, origin, and user
 * so entries from other builds or accounts never collide.
 */
export function offlineTranscriptOwner(userId: string): string {
  return `${window.location.origin}|${userId}|${import.meta.env.VITE_APP_VERSION || 'dev'}`
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = globalThis.indexedDB
  if (!factory) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close()
        return
      }
      settled = true
      resolve(database)
    }

    try {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
          database.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains(META_STORE_NAME)) {
          database.createObjectStore(META_STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => finish(request.result)
      request.onerror = () => finish(null)
      request.onblocked = () => finish(null)
    } catch {
      resolve(null)
    }
  })
}

async function runTransaction<T>(
  execute: (stores: OfflineTranscriptStores, setResult: (value: T) => void) => void,
): Promise<T | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise<T | null>((resolve) => {
    let result: T | null = null
    let finished = false
    const finish = (value: T | null) => {
      if (finished) return
      finished = true
      database.close()
      resolve(value)
    }

    try {
      const transaction = database.transaction([SNAPSHOT_STORE_NAME, META_STORE_NAME], 'readwrite')
      transaction.oncomplete = () => finish(result)
      transaction.onerror = () => finish(null)
      transaction.onabort = () => finish(null)
      execute(
        {
          snapshots: transaction.objectStore(SNAPSHOT_STORE_NAME),
          meta: transaction.objectStore(META_STORE_NAME),
        },
        (value) => {
          result = value
        },
      )
    } catch {
      finish(null)
    }
  })
}

/**
 * Evicts the least recently opened metadata entries for the owner, dropping each
 * evicted transcript from the snapshot store in the same transaction.
 */
function enforceOwnerLimit({ snapshots, meta }: OfflineTranscriptStores, owner: string): void {
  const request = meta.openCursor(prefixedKeyRange(ownerKeyPrefix(owner)))
  const entries: OfflineTranscriptMeta[] = []

  request.onsuccess = () => {
    const cursor = request.result
    if (cursor) {
      const entry = cursor.value as OfflineTranscriptMeta
      if (entry.owner === owner) entries.push(entry)
      cursor.continue()
      return
    }

    entries
      .sort((a, b) => b.openedAt - a.openedAt || compareKeys(a.key, b.key))
      .slice(OFFLINE_TRANSCRIPT_LIMIT)
      .forEach((entry) => {
        snapshots.delete(entry.key)
        meta.delete(entry.key)
      })
  }
}

function deletePrefixedKeys(store: IDBObjectStore): void {
  const request = store.openCursor(prefixedKeyRange(KEY_PREFIX))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    cursor.delete()
    cursor.continue()
  }
}

/**
 * Persists a transcript snapshot as idle so a later offline open never resumes
 * a stale running state. The least recently opened snapshots for the owner are
 * evicted once the limit is exceeded.
 */
export async function saveOfflineTranscript({
  owner,
  serverId,
  sessionId,
  cache,
  now = Date.now(),
}: SaveOfflineTranscriptInput): Promise<void> {
  const target = { owner, serverId, sessionId }
  const key = transcriptKey(target)
  const storedCache: TranscriptCache = {
    ...cache,
    transcript: {
      messages: cache.transcript.messages,
      pending: cache.transcript.pending,
      status: 'idle',
    },
  }

  await runTransaction<void>((stores) => {
    const existingRequest = stores.meta.get(key)
    existingRequest.onsuccess = () => {
      const existing = existingRequest.result as OfflineTranscriptMeta | undefined
      stores.snapshots.put({
        key,
        owner,
        serverId,
        sessionId,
        savedAt: now,
        openedAt: existing?.openedAt ?? now,
        cache: storedCache,
      } satisfies OfflineTranscriptRecord)
      stores.meta.put({
        key,
        owner,
        openedAt: existing?.openedAt ?? now,
      } satisfies OfflineTranscriptMeta)
      enforceOwnerLimit(stores, owner)
    }
  })
}

/**
 * Reads a stored transcript for the owner, refreshing its recency and deleting
 * it when it is older than the maximum age.
 */
export async function loadOfflineTranscript({
  owner,
  serverId,
  sessionId,
  now = Date.now(),
}: LoadOfflineTranscriptInput): Promise<TranscriptCache | null> {
  const target = { owner, serverId, sessionId }
  const key = transcriptKey(target)

  return runTransaction<TranscriptCache>((stores, setResult) => {
    const request = stores.snapshots.get(key)
    request.onsuccess = () => {
      const record = request.result as OfflineTranscriptRecord | undefined
      if (!record || record.owner !== owner) return
      if (now - record.savedAt > OFFLINE_TRANSCRIPT_MAX_AGE_MS) {
        stores.snapshots.delete(key)
        stores.meta.delete(key)
        return
      }
      stores.meta.put({ key, owner, openedAt: now } satisfies OfflineTranscriptMeta)
      setResult(record.cache)
    }
  })
}

/**
 * Refreshes the recency of a stored transcript and re-applies the owner limit.
 */
export async function markOfflineTranscriptOpened({
  owner,
  serverId,
  sessionId,
  now = Date.now(),
}: MarkOfflineTranscriptOpenedInput): Promise<void> {
  const target = { owner, serverId, sessionId }
  const key = transcriptKey(target)

  await runTransaction<void>((stores) => {
    const existingRequest = stores.meta.get(key)
    existingRequest.onsuccess = () => {
      const existing = existingRequest.result as OfflineTranscriptMeta | undefined
      if (!existing || existing.owner !== owner) return
      stores.meta.put({ key, owner, openedAt: now } satisfies OfflineTranscriptMeta)
      enforceOwnerLimit(stores, owner)
    }
  })
}

/**
 * Deletes every stored transcript snapshot, leaving unrelated IndexedDB keys
 * in the same database untouched.
 */
export async function clearOfflineTranscripts(): Promise<void> {
  await runTransaction<void>((stores) => {
    deletePrefixedKeys(stores.snapshots)
    deletePrefixedKeys(stores.meta)
  })
}
