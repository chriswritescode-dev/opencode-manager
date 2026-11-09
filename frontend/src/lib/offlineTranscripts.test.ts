import 'fake-indexeddb/auto'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  SessionInboxInfo,
  SessionMessageInfo,
  SessionStatus,
} from '@opencode-manager/shared/opencode'
import {
  emptySessionTranscript,
  type TranscriptCache,
} from '@/lib/session-projection'
import {
  OFFLINE_TRANSCRIPT_LIMIT,
  OFFLINE_TRANSCRIPT_MAX_AGE_MS,
  clearOfflineTranscripts,
  loadOfflineTranscript,
  markOfflineTranscriptOpened,
  offlineTranscriptOwner,
  saveOfflineTranscript,
} from './offlineTranscripts'

const DATABASE_NAME = 'ocm-offline-transcripts'
const STORE_NAME = 'snapshots'
const META_STORE_NAME = 'meta'
const KEY_PREFIX = 'ocm.transcript.v1:'

interface RawTranscriptRecord {
  key: string
  owner: string
  serverId: string
  sessionId: string
  savedAt: number
  openedAt: number
  cache: TranscriptCache
}

interface RawMetaRecord {
  key: string
  owner: string
  openedAt: number
}

function userMessage(id: string, text: string): SessionMessageInfo {
  return { id, type: 'user', text, time: { created: 1 } }
}

function pendingItem(id: string, text: string): SessionInboxInfo {
  return {
    id,
    sessionID: 'session',
    type: 'user',
    payload: { text },
    delivery: 'queue',
    time: { created: 2 },
  }
}

function idleCache(label: string): TranscriptCache {
  return {
    transcript: {
      ...emptySessionTranscript,
      messages: [userMessage(`msg_${label}`, label)],
    },
    nextCursor: `cursor_${label}`,
  }
}

const retryStatus: SessionStatus = {
  type: 'retry',
  attempt: 1,
  message: 'provider unavailable',
  next: 3,
}

function openRawDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(META_STORE_NAME)) {
        database.createObjectStore(META_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readStoreRecords<Record>(storeName: string): Promise<Record[]> {
  const database = await openRawDatabase()
  try {
    return await new Promise<Record[]>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).getAll()
      request.onsuccess = () => resolve(request.result as Record[])
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

function readRawRecords(): Promise<RawTranscriptRecord[]> {
  return readStoreRecords<RawTranscriptRecord>(STORE_NAME)
}

function readRawMeta(): Promise<RawMetaRecord[]> {
  return readStoreRecords<RawMetaRecord>(META_STORE_NAME)
}

async function countOwnerEntries(owner: string): Promise<number> {
  const records = await readRawRecords()
  return records.filter((record) => record.owner === owner).length
}

async function writeStoreRecord(storeName: string, record: unknown): Promise<void> {
  const database = await openRawDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

function writeRawRecord(record: RawTranscriptRecord): Promise<void> {
  return writeStoreRecord(STORE_NAME, record)
}

function writeRawMeta(record: RawMetaRecord): Promise<void> {
  return writeStoreRecord(META_STORE_NAME, record)
}

async function ownerStoreKeys(owner: string): Promise<{ snapshots: string[]; meta: string[] }> {
  const snapshots = (await readRawRecords())
    .filter((record) => record.owner === owner)
    .map((record) => record.key)
  const meta = (await readRawMeta())
    .filter((record) => record.owner === owner)
    .map((record) => record.key)
  return { snapshots: snapshots.sort(), meta: meta.sort() }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('offlineTranscripts', () => {
  it('scopes the owner to the origin, user, and app version', () => {
    const expectedVersion = import.meta.env.VITE_APP_VERSION || 'dev'

    expect(offlineTranscriptOwner('user-1')).toBe(
      `${window.location.origin}|user-1|${expectedVersion}`,
    )
  })

  it('resolves without throwing when IndexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    const target = { owner: 'owner', serverId: 'server', sessionId: 'session' }

    await expect(saveOfflineTranscript({ ...target, cache: idleCache('offline') })).resolves.toBeUndefined()
    await expect(loadOfflineTranscript(target)).resolves.toBeNull()
    await expect(markOfflineTranscriptOpened(target)).resolves.toBeUndefined()
    await expect(clearOfflineTranscripts()).resolves.toBeUndefined()
  })

  it('isolates transcripts by owner', async () => {
    const ownerA = 'owner-a'
    const ownerB = 'owner-b'
    const cacheA = idleCache('a')
    const cacheB = idleCache('b')

    await saveOfflineTranscript({
      owner: ownerA,
      serverId: 'server',
      sessionId: 'session',
      cache: cacheA,
      now: 1_000,
    })

    expect(
      await loadOfflineTranscript({
        owner: ownerB,
        serverId: 'server',
        sessionId: 'session',
        now: 1_000,
      }),
    ).toBeNull()

    await saveOfflineTranscript({
      owner: ownerB,
      serverId: 'server',
      sessionId: 'session',
      cache: cacheB,
      now: 2_000,
    })

    const loadedA = await loadOfflineTranscript({
      owner: ownerA,
      serverId: 'server',
      sessionId: 'session',
      now: 3_000,
    })
    const loadedB = await loadOfflineTranscript({
      owner: ownerB,
      serverId: 'server',
      sessionId: 'session',
      now: 3_000,
    })

    expect(loadedA?.transcript.messages).toEqual(cacheA.transcript.messages)
    expect(loadedA?.nextCursor).toBe(cacheA.nextCursor)
    expect(loadedB?.transcript.messages).toEqual(cacheB.transcript.messages)
    expect(loadedB?.nextCursor).toBe(cacheB.nextCursor)
  })

  it('keeps only the most recently opened transcripts per owner', async () => {
    const owner = 'owner-lru'
    const otherOwner = 'owner-other'

    await saveOfflineTranscript({
      owner: otherOwner,
      serverId: 'server',
      sessionId: 'other-session',
      cache: idleCache('other'),
      now: 1,
    })

    for (let index = 0; index < OFFLINE_TRANSCRIPT_LIMIT + 1; index += 1) {
      await saveOfflineTranscript({
        owner,
        serverId: 'server',
        sessionId: `session-${index}`,
        cache: idleCache(`lru-${index}`),
        now: 1_000 + index,
      })
    }

    expect(
      await loadOfflineTranscript({
        owner,
        serverId: 'server',
        sessionId: 'session-0',
        now: 10_000,
      }),
    ).toBeNull()
    expect(await countOwnerEntries(owner)).toBe(OFFLINE_TRANSCRIPT_LIMIT)
    expect(await countOwnerEntries(otherOwner)).toBe(1)

    const ownerStores = await ownerStoreKeys(owner)
    expect(ownerStores.snapshots).toEqual(ownerStores.meta)
    expect(ownerStores.snapshots).not.toContain(`${KEY_PREFIX}${owner}:server:session-0`)

    const otherOwnerStores = await ownerStoreKeys(otherOwner)
    expect(otherOwnerStores.snapshots).toEqual(otherOwnerStores.meta)
    expect(otherOwnerStores.snapshots).toHaveLength(1)

    const markOwner = 'owner-mark'
    for (let index = 0; index < OFFLINE_TRANSCRIPT_LIMIT; index += 1) {
      await saveOfflineTranscript({
        owner: markOwner,
        serverId: 'server',
        sessionId: `saved-${index}`,
        cache: idleCache(`mark-${index}`),
        now: 1 + index,
      })
    }

    const openedKey = `${KEY_PREFIX}${markOwner}:server:opened`
    await writeRawRecord({
      key: openedKey,
      owner: markOwner,
      serverId: 'server',
      sessionId: 'opened',
      savedAt: 500,
      openedAt: 500,
      cache: idleCache('opened'),
    })
    await writeRawMeta({ key: openedKey, owner: markOwner, openedAt: 500 })

    await markOfflineTranscriptOpened({
      owner: markOwner,
      serverId: 'server',
      sessionId: 'opened',
      now: 1_000,
    })

    expect(await countOwnerEntries(markOwner)).toBe(OFFLINE_TRANSCRIPT_LIMIT)
    const evictedKey = `${KEY_PREFIX}${markOwner}:server:saved-0`
    const markOwnerStores = await ownerStoreKeys(markOwner)
    expect(markOwnerStores.snapshots).toEqual(markOwnerStores.meta)
    expect(markOwnerStores.snapshots).not.toContain(evictedKey)
    expect(markOwnerStores.snapshots).toContain(openedKey)
    expect(
      await loadOfflineTranscript({
        owner: markOwner,
        serverId: 'server',
        sessionId: 'saved-0',
        now: 2_000,
      }),
    ).toBeNull()
    expect(
      await loadOfflineTranscript({
        owner: markOwner,
        serverId: 'server',
        sessionId: 'opened',
        now: 2_000,
      }),
    ).not.toBeNull()
  })

  it('refreshes recency in the meta store without rewriting the snapshot', async () => {
    const owner = 'owner-recency'
    const key = `${KEY_PREFIX}${owner}:server:session`

    await saveOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      cache: idleCache('recency'),
      now: 1_000,
    })

    await loadOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      now: 2_000,
    })

    const stored = (await readRawRecords()).find((record) => record.key === key)
    const meta = (await readRawMeta()).find((record) => record.key === key)
    expect(stored?.savedAt).toBe(1_000)
    expect(stored?.openedAt).toBe(1_000)
    expect(meta?.openedAt).toBe(2_000)
  })

  it('expires transcripts older than the maximum age', async () => {
    const owner = 'owner-expiry'
    const savedAt = 5_000

    await saveOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      cache: idleCache('expiry'),
      now: savedAt,
    })

    expect(
      await loadOfflineTranscript({
        owner,
        serverId: 'server',
        sessionId: 'session',
        now: savedAt + OFFLINE_TRANSCRIPT_MAX_AGE_MS + 1,
      }),
    ).toBeNull()

    expect(
      await loadOfflineTranscript({
        owner,
        serverId: 'server',
        sessionId: 'session',
        now: savedAt + 1,
      }),
    ).toBeNull()

    const expiredStores = await ownerStoreKeys(owner)
    expect(expiredStores.snapshots).toEqual([])
    expect(expiredStores.meta).toEqual([])
  })

  it('stores busy transcripts as idle without retry state', async () => {
    const owner = 'owner-idle-on-save'
    const pending = [pendingItem('inbox_1', 'queued prompt')]
    const cache: TranscriptCache = {
      transcript: {
        messages: [userMessage('msg_busy', 'hi')],
        pending,
        status: 'busy',
        retry: retryStatus,
      },
      nextCursor: 'cursor_busy',
    }

    await saveOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      cache,
      now: 1_000,
    })

    const loaded = await loadOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      now: 1_100,
    })

    expect(loaded).not.toBeNull()
    if (!loaded) return
    expect(loaded.transcript.status).toBe('idle')
    expect('retry' in loaded.transcript).toBe(false)
    expect(loaded.transcript.pending).toEqual(pending)
    expect(loaded.nextCursor).toBe('cursor_busy')
  })

  it('survives a query cache reset', async () => {
    const owner = 'owner-reset'
    const cache = idleCache('reset')

    await saveOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      cache,
      now: 1_000,
    })

    new QueryClient().clear()

    const loaded = await loadOfflineTranscript({
      owner,
      serverId: 'server',
      sessionId: 'session',
      now: 1_500,
    })

    expect(loaded?.transcript.messages).toEqual(cache.transcript.messages)
    expect(loaded?.nextCursor).toBe(cache.nextCursor)
  })

  it('clears only prefixed transcripts from both stores', async () => {
    const prefixedKey = `${KEY_PREFIX}raw-owner:server:session`
    const unrelatedKey = 'ocm.other:keep'

    await writeRawRecord({
      key: prefixedKey,
      owner: 'raw-owner',
      serverId: 'server',
      sessionId: 'session',
      savedAt: 0,
      openedAt: 0,
      cache: idleCache('raw'),
    })
    await writeRawMeta({ key: prefixedKey, owner: 'raw-owner', openedAt: 0 })
    await writeRawRecord({
      key: unrelatedKey,
      owner: '',
      serverId: '',
      sessionId: '',
      savedAt: 0,
      openedAt: 0,
      cache: idleCache('unrelated'),
    })
    await writeRawMeta({ key: unrelatedKey, owner: '', openedAt: 0 })

    await clearOfflineTranscripts()

    const snapshotKeys = (await readRawRecords()).map((record) => record.key)
    const metaKeys = (await readRawMeta()).map((record) => record.key)
    expect(snapshotKeys).not.toContain(prefixedKey)
    expect(metaKeys).not.toContain(prefixedKey)
    expect(snapshotKeys).toContain(unrelatedKey)
    expect(metaKeys).toContain(unrelatedKey)
  })
})
