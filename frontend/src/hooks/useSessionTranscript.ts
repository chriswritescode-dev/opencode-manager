import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { listSessionMessages, readSessionSnapshot } from '@/api/opencode'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import {
  applySessionEvent,
  emptySessionTranscript,
  hydrateSessionTranscript,
  sessionIDFromEvent,
  type SessionSnapshot,
  type SessionTranscript,
} from '@/lib/session-projection'

interface TranscriptCache {
  transcript: SessionTranscript
  nextCursor?: string
}

interface NewestPageRead {
  buffered: V2Event[]
  queued: Set<V2Event>
}

const MAX_NEWEST_PAGE_READS = 4
const RESYNC_SETTLE_MS = 150

function hydrateCache(snapshot: SessionSnapshot): TranscriptCache {
  return { transcript: hydrateSessionTranscript(snapshot), nextCursor: snapshot.nextCursor }
}

export function useSessionTranscript(sessionID: string, directory: string) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => sessionTranscriptQueryKey(sessionID), [sessionID])
  const queuedEventsRef = useRef<V2Event[]>([])
  const frameRef = useRef<number | null>(null)
  const connectedRef = useRef<boolean | null>(null)
  const fetchingOlderRef = useRef(false)
  const newestReadRef = useRef<NewestPageRead | null>(null)
  const newestReadGenerationRef = useRef(0)
  const cursorGenerationRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resyncPendingRef = useRef(false)
  const readNewestPageRef = useRef<(() => Promise<TranscriptCache>) | null>(null)

  const currentCache = useCallback(
    (): TranscriptCache =>
      queryClient.getQueryData<TranscriptCache>(queryKey) ?? {
        transcript: emptySessionTranscript,
      },
    [queryClient, queryKey],
  )

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current === null) return
    clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
  }, [])

  const scheduleResync = useCallback(() => {
    resyncPendingRef.current = true
    clearSettleTimer()
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      resyncPendingRef.current = false
      void readNewestPageRef.current?.().catch(() => undefined)
    }, RESYNC_SETTLE_MS)
  }, [clearSettleTimer])

  const commitNewestPage = useCallback(
    (read: NewestPageRead, snapshot: SessionSnapshot): TranscriptCache => {
      clearSettleTimer()
      resyncPendingRef.current = false
      queuedEventsRef.current = queuedEventsRef.current.filter(
        (event) => !read.queued.has(event),
      )
      const next = hydrateCache(snapshot)
      cursorGenerationRef.current += 1
      queryClient.setQueryData<TranscriptCache>(queryKey, next)
      return next
    },
    [clearSettleTimer, queryClient, queryKey],
  )

  const readNewestPage = useCallback(async (): Promise<TranscriptCache> => {
    const generation = (newestReadGenerationRef.current += 1)
    const read: NewestPageRead = {
      buffered: [],
      queued: new Set(queuedEventsRef.current),
    }
    newestReadRef.current = read
    let snapshot: SessionSnapshot
    try {
      snapshot = await readSessionSnapshot(sessionID)
      for (let attempt = 1; attempt < MAX_NEWEST_PAGE_READS; attempt += 1) {
        if (newestReadGenerationRef.current !== generation) break
        if (read.buffered.length === 0) break
        read.buffered = []
        read.queued = new Set(queuedEventsRef.current)
        snapshot = await readSessionSnapshot(sessionID)
      }
    } finally {
      if (newestReadRef.current === read) newestReadRef.current = null
    }
    if (newestReadGenerationRef.current !== generation) {
      return queryClient.getQueryData<TranscriptCache>(queryKey) ?? hydrateCache(snapshot)
    }
    if (read.buffered.length > 0) {
      scheduleResync()
      return currentCache()
    }
    return commitNewestPage(read, snapshot)
  }, [commitNewestPage, currentCache, queryClient, queryKey, scheduleResync, sessionID])

  const query = useQuery({
    queryKey,
    queryFn: () => readNewestPage(),
    enabled: Boolean(sessionID && directory),
  })

  const fetchOlder = useCallback(async () => {
    const cursor = queryClient.getQueryData<TranscriptCache>(queryKey)?.nextCursor
    if (!cursor || fetchingOlderRef.current) return
    fetchingOlderRef.current = true
    const generation = cursorGenerationRef.current
    try {
      const page = await listSessionMessages(sessionID, { cursor })
      if (cursorGenerationRef.current !== generation) return
      queryClient.setQueryData<TranscriptCache>(queryKey, (current) => {
        if (!current) return current
        const known = new Set(current.transcript.messages.map((message) => message.id))
        const older = page.messages.filter((message) => !known.has(message.id))
        return {
          transcript: {
            ...current.transcript,
            messages: [...older, ...current.transcript.messages],
          },
          nextCursor: page.nextCursor,
        }
      })
    } finally {
      fetchingOlderRef.current = false
    }
  }, [queryClient, queryKey, sessionID])

  useEffect(() => {
    if (!sessionID || !directory) return

    readNewestPageRef.current = readNewestPage

    const flush = () => {
      frameRef.current = null
      const events = queuedEventsRef.current
      if (events.length === 0) return
      queuedEventsRef.current = []
      queryClient.setQueryData<TranscriptCache>(queryKey, (current) => {
        const base = current ?? { transcript: emptySessionTranscript }
        const transcript = events.reduce(applySessionEvent, base.transcript)
        return transcript === base.transcript ? base : { ...base, transcript }
      })
    }

    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: [directory],
      onEvent: (data) => {
        const event = data as V2Event
        if (sessionIDFromEvent(event) !== sessionID) return
        newestReadRef.current?.buffered.push(event)
        queuedEventsRef.current.push(event)
        if (resyncPendingRef.current) scheduleResync()
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(flush)
        }
      },
      onStatusChange: (connected) => {
        const wasConnected = connectedRef.current
        connectedRef.current = connected
        if (!connected || wasConnected !== false) return
        void readNewestPage().catch(() => undefined)
      },
      onResync: () => {
        void readNewestPage().catch(() => undefined)
      },
    })

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      clearSettleTimer()
      resyncPendingRef.current = false
      readNewestPageRef.current = null
      newestReadGenerationRef.current += 1
      queuedEventsRef.current = []
      newestReadRef.current = null
      subscription.dispose()
    }
  }, [clearSettleTimer, directory, queryClient, queryKey, readNewestPage, scheduleResync, sessionID])

  return {
    messages: query.data?.transcript.messages ?? [],
    pending: query.data?.transcript.pending ?? [],
    status: query.data?.transcript.status ?? 'idle',
    isLoading: query.isPending,
    fetchOlder,
    hasOlder: Boolean(query.data?.nextCursor),
  }
}
