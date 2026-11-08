import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SandboxedHtmlFrame } from '@/components/ui/sandboxed-html-frame'
import { OUTPUT_LIMITS } from '@opencode-manager/shared/schemas'
import type { OutputHostMessage } from '@opencode-manager/shared/schemas'
import { clampFrameHeight, parseFrameMessage, readOutputThemeTokens } from '@/lib/outputBridge'

export interface OutputTemplateFrameProps {
  src: string
  data: unknown
  reloadKey?: string | number
  onOpenFile?: (path: string, line?: number) => void
  onRefine?: (text: string) => void
  title?: string
}

/** Hosts a template output iframe, bridges its messages to the app, and confirms refine requests. */
export function OutputTemplateFrame({
  src,
  data,
  reloadKey,
  onOpenFile,
  onRefine,
  title = 'Output',
}: OutputTemplateFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hasLoadedRef = useRef(false)
  const onOpenFileRef = useRef(onOpenFile)
  const onRefineRef = useRef(onRefine)
  const [height, setHeight] = useState<number>(OUTPUT_LIMITS.FRAME_MIN_HEIGHT)
  const [pendingRefine, setPendingRefine] = useState<string | null>(null)

  useEffect(() => {
    onOpenFileRef.current = onOpenFile
  }, [onOpenFile])

  useEffect(() => {
    onRefineRef.current = onRefine
  }, [onRefine])

  const handleLoad = () => {
    hasLoadedRef.current = true
    const message: OutputHostMessage = {
      type: 'ui/initialize',
      data,
      theme: readOutputThemeTokens(),
    }
    frameRef.current?.contentWindow?.postMessage(message, '*')
  }

  useEffect(() => {
    if (!hasLoadedRef.current) return
    const message: OutputHostMessage = { type: 'ui/data', data }
    frameRef.current?.contentWindow?.postMessage(message, '*')
  }, [data])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = parseFrameMessage(event, frameRef.current?.contentWindow ?? null)
      if (!message) return

      if (message.type === 'ui/size') {
        setHeight(clampFrameHeight(message.height))
        return
      }

      if (message.type === 'ui/open-file') {
        onOpenFileRef.current?.(message.path, message.line)
        return
      }

      if (onRefineRef.current) {
        setPendingRefine(message.text)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SandboxedHtmlFrame
        ref={frameRef}
        src={src}
        title={title}
        reloadKey={reloadKey}
        onLoad={handleLoad}
        style={{ height }}
      />
      {pendingRefine && onRefine ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">This output asks to send: {pendingRefine}</p>
          <Button
            size="sm"
            onClick={() => {
              onRefine(pendingRefine)
              setPendingRefine(null)
            }}
          >
            Send
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPendingRefine(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  )
}
