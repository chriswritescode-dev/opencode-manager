import { useEffect, useRef } from 'react'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'
import { collectOpenWalkthroughCalls } from '@/lib/walkthroughTool'

interface UseAutoOpenWalkthroughOptions {
  sessionId: string | undefined
  messages: SessionMessageInfo[]
  enabled: boolean
  loading: boolean
  onOpen: (source?: WalkthroughSource) => void
}

/**
 * Opens the change walkthrough when an `open_walkthrough` tool call completes live in the viewed
 * session. Calls present at the first loaded render are treated as history and ignored, and calls in
 * messages older than that render's oldest message stay ignored when the transcript pages in older
 * history. Each call opens at most once. `enabled` gates the automatic open so a mode where the
 * walkthrough is a full-screen dialog (mobile) leaves the user to open it from the tool call row.
 */
export function useAutoOpenWalkthrough({
  sessionId,
  messages,
  enabled,
  loading,
  onOpen,
}: UseAutoOpenWalkthroughOptions): void {
  const seenRef = useRef<Set<string> | null>(null)
  const frontierRef = useRef<string | null>(null)
  const lastScannedRef = useRef<string | null>(null)
  const sessionRef = useRef<string | undefined>(undefined)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (sessionRef.current !== sessionId || loading) {
      sessionRef.current = sessionId
      seenRef.current = null
      frontierRef.current = null
      lastScannedRef.current = null
    }
    if (loading) return
    if (seenRef.current === null) {
      seenRef.current = new Set(collectOpenWalkthroughCalls(messages).map((call) => call.id))
      frontierRef.current = messages[0]?.id ?? null
      lastScannedRef.current = messages[messages.length - 1]?.id ?? null
      return
    }
    const lastScannedId = lastScannedRef.current
    let scanFrom = -1
    if (lastScannedId !== null) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.id === lastScannedId) {
          scanFrom = index
          break
        }
      }
    }
    let liveMessages: SessionMessageInfo[]
    if (scanFrom >= 0) {
      liveMessages = messages.slice(scanFrom)
    } else {
      const frontier = frontierRef.current
      liveMessages = frontier === null ? messages : messages.filter((message) => message.id >= frontier)
    }
    lastScannedRef.current = messages[messages.length - 1]?.id ?? null
    let opened = false
    for (const call of collectOpenWalkthroughCalls(liveMessages)) {
      if (seenRef.current.has(call.id)) continue
      seenRef.current.add(call.id)
      if (enabled && !opened) {
        opened = true
        onOpenRef.current(call.source)
      }
    }
  }, [sessionId, messages, enabled, loading])
}
