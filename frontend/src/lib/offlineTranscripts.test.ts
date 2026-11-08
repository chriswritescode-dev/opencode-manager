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
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readRawRecords(): Promise<RawTranscriptRecord[]> {
  const database = await openRawDatabase()
  try {
    return await new Promise<RawTranscriptRecord[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as RawTranscriptRecord[])
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

async function countOwnerEntries(owner: string): Promise<number> {
  const records = await readRawRecords()
  return records.filter((record) => record.owner === owner).length
}

async function writeRawRecord(record: RawTranscriptRecord): Promise<void> {
  const database = await openRawDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
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

    await writeRawRecord({
      key: `${KEY_PREFIX}${markOwner}:server:opened`,
      owner: markOwner,
      serverId: 'server',
      sessionId: 'opened',
      savedAt: 500,
      openedAt: 500,
      cache: idleCache('opened'),
    })

    await markOfflineTranscriptOpened({
      owner: markOwner,
      serverId: 'server',
      sessionId: 'opened',
      now: 1_000,
    })

    expect(await countOwnerEntries(markOwner)).toBe(OFFLINE_TRANSCRIPT_LIMIT)
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

  it('clears only prefixed transcripts', async () => {
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
    await writeRawRecord({
      key: unrelatedKey,
      owner: '',
      serverId: '',
      sessionId: '',
      savedAt: 0,
      openedAt: 0,
      cache: idleCache('unrelated'),
    })

    await clearOfflineTranscripts()

    const keys = (await readRawRecords()).map((record) => record.key)
    expect(keys).not.toContain(prefixedKey)
    expect(keys).toContain(unrelatedKey)
  })
})
