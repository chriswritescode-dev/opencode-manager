import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  ManagerLogEntry,
  ManagerLogLevel,
  ManagerLogSource,
  ManagerLogsResponse,
} from '@opencode-manager/shared/schemas'
import { DEFAULTS } from '@/config'
import { logsApi } from '@/api/logs'

export interface UseManagerLogsOptions {
  enabled?: boolean
  paused?: boolean
  level?: ManagerLogLevel
  source?: ManagerLogSource
}

interface UseManagerLogsResult {
  entries: ManagerLogEntry[]
  dropped: number
  isLoading: boolean
  error: unknown
  clear: () => void
}

interface ManagerLogsQueryData {
  response: ManagerLogsResponse
  instanceToken: number
  generation: number
  requestedAfterSeq: number | undefined
}

let instanceCounter = 0

export function useManagerLogs({
  enabled = true,
  paused = false,
  level,
  source,
}: UseManagerLogsOptions = {}): UseManagerLogsResult {
  const [entries, setEntries] = useState<ManagerLogEntry[]>([])
  const [dropped, setDropped] = useState(0)
  const cursorRef = useRef<number | undefined>(undefined)
  const instanceTokenRef = useRef(0)
  const lastAcceptedInstanceIdRef = useRef<string | undefined>(undefined)
  const generationRef = useRef(0)
  const [prevFilter, setPrevFilter] = useState<{ level?: ManagerLogLevel; source?: ManagerLogSource }>({
    level,
    source,
  })

  if (instanceTokenRef.current === 0) {
    instanceCounter += 1
    instanceTokenRef.current = instanceCounter
  }

  if (prevFilter.level !== level || prevFilter.source !== source) {
    setPrevFilter({ level, source })
    generationRef.current += 1
    cursorRef.current = undefined
    setEntries([])
    setDropped(0)
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['manager-logs', level ?? null, source ?? null],
    queryFn: () => {
      const requestedAfterSeq = cursorRef.current
      const instanceToken = instanceTokenRef.current
      const generation = generationRef.current
      return logsApi
        .getManagerLogs({ afterSeq: requestedAfterSeq, level, source })
        .then(
          (response): ManagerLogsQueryData => ({ response, instanceToken, generation, requestedAfterSeq })
        )
    },
    enabled,
    refetchInterval: paused ? false : DEFAULTS.LOGS.POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
    staleTime: 0,
    retry: false,
  })

  useEffect(() => {
    if (!data) return
    if (data.instanceToken !== instanceTokenRef.current) return
    if (data.generation !== generationRef.current) return
    if (data.requestedAfterSeq !== cursorRef.current) return
    if (
      lastAcceptedInstanceIdRef.current !== undefined &&
      data.response.instanceId !== lastAcceptedInstanceIdRef.current
    ) {
      lastAcceptedInstanceIdRef.current = data.response.instanceId
      cursorRef.current = undefined
      setEntries([])
      setDropped(0)
      void refetch()
      return
    }
    lastAcceptedInstanceIdRef.current = data.response.instanceId
    const fresh = data.response.entries.filter((entry) => entry.seq > (cursorRef.current ?? 0))
    setDropped(data.response.dropped)
    if (fresh.length === 0) {
      cursorRef.current = data.response.latestSeq
      return
    }
    cursorRef.current = fresh[fresh.length - 1].seq
    setEntries((prev) => [...prev, ...fresh].slice(-DEFAULTS.LOGS.BUFFER_CAPACITY))
  }, [data, refetch])

  const clear = () => {
    setEntries([])
  }

  return { entries, dropped, isLoading, error, clear }
}
