import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from '@opencode-manager/shared'
import { sessionIDFromEvent, type V2Event } from '@opencode-manager/shared/opencode'
import { buildServerDirectoryKey, LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { listSessionMessages, readSessionSnapshot } from '@/api/opencode'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import {
  applySessionEvents,
  emptySessionTranscript,
  eventsReplayableOverSnapshot,
  mergeNewestPage,
  type SessionSnapshot,
  type TranscriptCache,
} from '@/lib/session-projection'

interface NewestPageRead {
  buffered: V2Event[]
  queued: Set<V2Event>
}

const TRANSCRIPT_FALLBACK_POLL_INTERVAL_MS = 5000

export function useSessionTranscript(sessionID: string, directory: string) {
  const serverId = useOpenCodeServerId()
  const isRemoteServer = !isLocalOpenCodeServer(serverId)
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => serverScopedKey(sessionTranscriptQueryKey(sessionID), serverId),
    [sessionID, serverId],
  )
  const queuedEventsRef = useRef<V2Event[]>([])
  const frameRef = useRef<number | null>(null)
  const connectedRef = useRef<boolean | null>(null)
  const fetchingOlderRef = useRef(false)
  const newestReadRef = useRef<NewestPageRead | null>(null)
  const newestReadGenerationRef = useRef(0)
  const cursorGenerationRef = useRef(0)
  const latestNewestReadRef = useRef<Promise<TranscriptCache> | null>(null)
  const [isStreamConnected, setIsStreamConnected] = useState(false)
  const { statusById } = useOpenCodeServerStatuses({ enabled: isRemoteServer })
  const isStreamHealthy = isStreamConnected && (!isRemoteServer || statusById[serverId]?.connected === true)

  const performNewestPageRead = useCallback(async (): Promise<TranscriptCache> => {
    const generation = (newestReadGenerationRef.current += 1)
    const read: NewestPageRead = {
      buffered: [],
      queued: new Set(queuedEventsRef.current),
    }
    newestReadRef.current = read
    let snapshot: SessionSnapshot
    try {
      snapshot = await readSessionSnapshot(sessionID, serverId)
    } finally {
      if (newestReadRef.current === read) newestReadRef.current = null
    }
    if (newestReadGenerationRef.current !== generation) {
      return (
        latestNewestReadRef.current ??
        queryClient.getQueryData<TranscriptCache>(queryKey) ??
        mergeNewestPage(undefined, snapshot)
      )
    }
    const current = queryClient.getQueryData<TranscriptCache>(queryKey)
    const applied = new Set(read.buffered)
    queuedEventsRef.current = queuedEventsRef.current.filter(
      (event) => !read.queued.has(event) && !applied.has(event),
    )
    const merged = mergeNewestPage(current, snapshot)
    const next: TranscriptCache = {
      ...merged,
      transcript: applySessionEvents(
        merged.transcript,
        eventsReplayableOverSnapshot(read.buffered, merged.transcript),
      ).transcript,
    }
    if (next.nextCursor !== current?.nextCursor) cursorGenerationRef.current += 1
    queryClient.setQueryData<TranscriptCache>(queryKey, next)
    return next
  }, [queryClient, queryKey, sessionID, serverId])

  const readNewestPage = useCallback((): Promise<TranscriptCache> => {
    const read = performNewestPageRead()
    latestNewestReadRef.current = read
    return read
  }, [performNewestPageRead])

  const query = useQuery({
    queryKey,
    queryFn: () => readNewestPage(),
    enabled: Boolean(sessionID && directory),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: isStreamHealthy ? false : TRANSCRIPT_FALLBACK_POLL_INTERVAL_MS,
    retry: (failureCount, error) =>
      !(error instanceof FetchError && (error.statusCode === 400 || error.statusCode === 404))
      && failureCount < 3,
  })

  const fetchOlder = useCallback(async () => {
    const cursor = queryClient.getQueryData<TranscriptCache>(queryKey)?.nextCursor
    if (!cursor || fetchingOlderRef.current) return
    fetchingOlderRef.current = true
    const generation = cursorGenerationRef.current
    try {
      const page = await listSessionMessages(sessionID, { cursor }, serverId)
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
  }, [queryClient, queryKey, sessionID, serverId])

  useEffect(() => {
    if (!sessionID || !directory) return

    const refreshNewestPage = () => {
      void readNewestPage().catch(() => undefined)
    }

    const flush = () => {
      frameRef.current = null
      const events = queuedEventsRef.current
      if (events.length === 0) return
      queuedEventsRef.current = []
      const base = queryClient.getQueryData<TranscriptCache>(queryKey) ?? {
        transcript: emptySessionTranscript,
      }
      const { transcript, requiresResync } = applySessionEvents(base.transcript, events)
      if (transcript !== base.transcript) {
        queryClient.setQueryData<TranscriptCache>(queryKey, { ...base, transcript })
      }
      if (requiresResync) refreshNewestPage()
    }

    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: [buildServerDirectoryKey(serverId, directory)],
      onEvent: (data) => {
        const event = data as V2Event & { serverId?: string }
        if ((event.serverId ?? LOCAL_OPENCODE_SERVER_ID) !== serverId) return
        if (sessionIDFromEvent(event) !== sessionID) return
        newestReadRef.current?.buffered.push(event)
        queuedEventsRef.current.push(event)
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(flush)
        }
      },
      onStatusChange: (connected) => {
        const wasConnected = connectedRef.current
        connectedRef.current = connected
        setIsStreamConnected(connected)
        if (!connected || wasConnected !== false) return
        refreshNewestPage()
      },
      onResync: (_subscribedDirectories: string[], resyncServerId?: string) => {
        if ((resyncServerId ?? LOCAL_OPENCODE_SERVER_ID) !== serverId) return
        refreshNewestPage()
      },
    })

    if (queryClient.getQueryData<TranscriptCache>(queryKey)) {
      refreshNewestPage()
    }

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      newestReadGenerationRef.current += 1
      latestNewestReadRef.current = null
      connectedRef.current = null
      queuedEventsRef.current = []
      newestReadRef.current = null
      subscription.dispose()
    }
  }, [directory, queryClient, queryKey, readNewestPage, sessionID, serverId])

  return {
    messages: query.data?.transcript.messages ?? [],
    pending: query.data?.transcript.pending ?? [],
    status: query.data?.transcript.status ?? 'idle',
    isLoading: query.isPending,
    fetchOlder,
    hasOlder: Boolean(query.data?.nextCursor),
  }
}
