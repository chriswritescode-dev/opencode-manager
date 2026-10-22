import { useRef, useEffect, useMemo, memo } from 'react'
import { unwrapSandboxExecCommand } from '@opencode-manager/shared/utils'
import { toolContentText, type SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { useChildLifecycleForSession } from '@/stores/sessionStatusStore'
import { useToolCallPermission } from '@/contexts/EventContext'
import { useChildSessionReconciliation } from '@/hooks/useOpenCode'
import { useShell } from '@/hooks/useSessionShells'
import { useMobile } from '@/hooks/useMobile'
import { clampDisplayText } from '@/lib/clampDisplayText'
import { cn } from '@/lib/utils'
import { ExternalLink, Loader2, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { BackgroundTaskStatusIcon } from '@/components/session/BackgroundTaskStatusIcon'
import {
  backgroundChildSessionID,
  backgroundShellID,
  backgroundTaskStatusColor,
  isRunningLifecycle,
  lifecycleLabel,
  shellToolLifecycle,
  subagentLifecycle,
  subagentSessionID,
  toolMetadata,
  type BackgroundTaskLifecycle,
  type ShellNoticeOutcome,
} from '@/lib/backgroundWork'
import { getToolInputPath, getToolSpecificRender } from './FileToolRender'
import { readOpenWalkthroughCall } from '@/lib/walkthroughTool'
import { readShowArtifactCall } from '@/lib/artifactTool'
import { getWorkspaceFilePath } from '@/lib/markdownLinks'
import { getFileApiUrl } from '@/api/files'
import { ArtifactPart } from './ArtifactPart'
import { ExecuteToolPart } from './ExecuteToolPart'
import { FileReferenceText } from './FileReferenceText'
import { ShellPreview, ToolDetails, useToolDetailsState } from './ToolDetails'
import { ToolContentFiles } from './ToolContentFiles'
import { TRANSCRIPT_DETAIL_CLASS, TRANSCRIPT_ROW_CLASS } from './transcriptStyles'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'

function BoundedPre({ content, className }: { content: string; className: string }) {
  const clamped = useMemo(() => clampDisplayText(content), [content])
  return <pre className={className}>{clamped}</pre>
}

interface ToolCallPartProps {
  part: SessionMessageAssistantTool
  messageID?: string
  directory?: string
  repoFullPath?: string
  repoLocalPath?: string
  shellOutcome?: ShellNoticeOutcome
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  onOpenWalkthrough?: (source?: WalkthroughSource) => void
}

function toolInput(part: SessionMessageAssistantTool): Record<string, unknown> | undefined {
  if (part.state.status === 'streaming') return undefined
  return part.state.input
}

function toolOutputText(part: SessionMessageAssistantTool): string {
  if (part.state.status === 'streaming') return ''
  return toolContentText(part.state.status === 'running' ? undefined : part.state.content)
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const jsonString = useMemo(() => JSON.stringify(json, null, 2), [json])

  return (
    <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
      <FileReferenceText text={jsonString} onFileClick={onFileClick} />
    </pre>
  )
}

export const ToolCallPart = memo(function ToolCallPart({ part, messageID, directory, repoFullPath, repoLocalPath, shellOutcome, onFileClick, onChildSessionClick, onOpenWalkthrough }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const isMobile = useMobile()
  const isSubagent = part.name === 'subagent'
  const subagentSessionId = isSubagent ? subagentSessionID(part) : undefined
  const backgroundSubagent = isSubagent ? backgroundChildSessionID(part) : undefined
  const subagentSessionLifecycle = useChildLifecycleForSession(subagentSessionId)
  useChildSessionReconciliation(
    subagentSessionId && (backgroundSubagent !== undefined || part.state.status === 'running')
      ? subagentSessionId
      : undefined,
  )
  const subagentStatus = subagentLifecycle(
    part.state.status,
    backgroundSubagent !== undefined,
    subagentSessionLifecycle,
  )
  const backgroundShell = part.name === 'shell' ? backgroundShellID(part) : undefined
  const { shell, listLoaded: shellListLoaded } = useShell(backgroundShell, directory)
  const shellStatus = shellToolLifecycle(backgroundShell, shell, shellListLoaded, shellOutcome)
  const isBackgroundShell = backgroundShell !== undefined
  const isBackgroundShellRunning = isBackgroundShell && isRunningLifecycle(shellStatus)
  const pendingPermission = useToolCallPermission(part.id, messageID)
  const isWaitingPermission = part.state.status === 'running' && pendingPermission !== null
  const outputRef = useRef<HTMLDivElement>(null)
  const input = toolInput(part)
  const openWalkthrough = readOpenWalkthroughCall(part)
  const rawCommand = part.name === 'shell' && typeof input?.command === 'string'
    ? input.command
    : undefined
  const displayCommand = useMemo(
    () => (rawCommand === undefined ? undefined : unwrapSandboxExecCommand(rawCommand)),
    [rawCommand]
  )
  const isSandboxedCommand =
    part.state.status === 'completed' &&
    (toolMetadata(part).sandbox === true ||
      (rawCommand !== undefined && displayCommand !== rawCommand))
  const sandboxProvider = (() => {
    const provider = toolMetadata(part).sandboxProvider
    return typeof provider === 'string' ? provider : undefined
  })()
  const sandboxProviderLabel = sandboxProvider !== undefined && sandboxProvider !== 'ocm' ? sandboxProvider : undefined
  const [detailsOpen, setDetailsOpen] = useToolDetailsState(preferences?.expandToolCalls ?? false)

  useEffect(() => {
    if (isMobile) return
    if (part.name === 'shell' && detailsOpen && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [detailsOpen, isMobile, part.name])

  const getStatusColor = () => {
    if (isBackgroundShell) return backgroundTaskStatusColor(shellStatus)
    switch (part.state.status) {
      case 'completed':
        return 'text-success'
      case 'error':
        return 'text-destructive'
      case 'running':
        if (isWaitingPermission) return 'text-highlight'
        return 'text-warning'
      default:
        return 'text-muted-foreground'
    }
  }

  const renderShellLifecycleIcon = (status: BackgroundTaskLifecycle) => (
    <BackgroundTaskStatusIcon status={status} className="w-3.5 h-3.5" />
  )

  const getStatusIcon = () => {
    if (isBackgroundShell) return renderShellLifecycleIcon(shellStatus)
    switch (part.state.status) {
      case 'completed':
        return <span>✓</span>
      case 'error':
        return <span>✗</span>
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 animate-spin" />
      case 'streaming':
        return <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
      default:
        return <span>○</span>
    }
  }

  const getPreviewText = () => {
    if (!input) return null

    switch (part.name) {
      case 'read':
      case 'write':
      case 'edit':
      case 'patch':
        return getToolInputPath(input) ?? null
      case 'shell':
        return displayCommand || null
      case 'glob':
      case 'grep':
        return (input.pattern as string) || null
      case 'subagent':
        return (input.description as string) || null
      case 'webfetch':
        return (input.url as string) || null
      case 'websearch':
        return (input.query as string) || null
      default:
        return null
    }
  }

  const previewText = getPreviewText()
  const isFileTool = ['read', 'write', 'edit', 'patch'].includes(part.name)
  const isBackgroundSubagent = backgroundSubagent !== undefined
  const isBackgroundSubagentRunning = isBackgroundSubagent && isRunningLifecycle(subagentStatus)
  const isBackgrounded = isBackgroundShell ? isBackgroundShellRunning : isBackgroundSubagentRunning
  const backgroundIndicator = isBackgrounded ? (
    <Badge
      variant="outline"
      className="shrink-0 border-warning/40 bg-warning/10 text-warning"
      title="Continues running in the background; the session is notified when it finishes"
    >
      background
    </Badge>
  ) : null
  const sandboxIndicator = isSandboxedCommand ? (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 border-success/40 bg-success/15 text-success"
      title={
        sandboxProviderLabel !== undefined
          ? `Executed inside the ${sandboxProviderLabel} sandbox`
          : 'Executed inside the sandbox microVM'
      }
    >
      <Shield className="w-3 h-3" />
      {sandboxProviderLabel !== undefined ? `sandbox · ${sandboxProviderLabel}` : 'sandbox'}
    </Badge>
  ) : null

  const artifact = readShowArtifactCall(part)
  if (artifact && (artifact.resolvedPath || artifact.path.startsWith('/') || directory)) {
    const servedPath = getWorkspaceFilePath(artifact.resolvedPath ?? artifact.path, {
      directory,
      repoFullPath,
      repoLocalPath,
    })
    return <ArtifactPart title={artifact.title} path={artifact.path} src={getFileApiUrl(servedPath, { params: { raw: true } })} />
  }

  if (isSubagent) {
    const status = part.state.status
    const isRunning = status !== 'streaming' && isRunningLifecycle(subagentStatus)
    const isCompleted = subagentStatus === 'completed'
    const isError = subagentStatus === 'failed'
    const description = previewText || 'Sub-agent task'

    const content = (
      <div className="flex items-center gap-2 min-w-0">
        {status === 'streaming' && (
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
          </div>
        )}
        {isRunning && (
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {isCompleted && <span className="text-success text-sm font-medium">✓</span>}
        {isError && <span className="text-destructive text-sm font-medium">✗</span>}
        <span className="font-medium text-foreground truncate">{description}</span>
        <span className="text-[11px] font-medium text-highlight shrink-0">sub-agent</span>
        {backgroundIndicator}
        {subagentSessionId && <ExternalLink className="w-3 h-3 shrink-0 text-primary" />}
      </div>
    )

    if (subagentSessionId) {
      return (
        <button
          onClick={() => onChildSessionClick?.(subagentSessionId)}
          className="my-1 flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="View subagent session"
        >
          {content}
        </button>
      )
    }

    return (
      <div className="my-1 flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-xs text-muted-foreground">
        {content}
      </div>
    )
  }

  if (part.name === 'execute') {
    return <ExecuteToolPart part={part} isWaitingPermission={isWaitingPermission} onFileClick={onFileClick} />
  }

  const toolSpecificRender = getToolSpecificRender(part, onFileClick)
  if (toolSpecificRender) {
    return toolSpecificRender
  }

  const output = toolOutputText(part)
  const statusLabel = isWaitingPermission
    ? 'awaiting permission'
    : isBackgroundShell
      ? lifecycleLabel(shellStatus)
      : part.state.status
  const commandBlock = (
    <div className="text-sm">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-muted-foreground">Command:</div>
        <CopyButton content={displayCommand ?? ''} title="Copy command" />
      </div>
      <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
        <span className="text-success">$</span> {displayCommand ?? ''}
      </div>
    </div>
  )

  const detailContent = (
    <>
      {part.state.status === 'streaming' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>Preparing tool call...</span>
        </div>
      )}

      {part.state.status === 'running' && (
        <div className="text-sm">
          {part.name === 'shell' ? commandBlock : (
            <>
              <div className="text-muted-foreground mb-1">Input:</div>
              <ClickableJson json={part.state.input} onFileClick={onFileClick} />
            </>
          )}
          <div className={`flex items-center gap-2 mt-2 text-xs ${isWaitingPermission ? 'text-highlight' : 'text-warning'}`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{isWaitingPermission ? 'Waiting for permission...' : 'Running...'}</span>
          </div>
        </div>
      )}

      {part.state.status === 'completed' && (
        <>
          {part.name === 'shell' ? commandBlock : (
            <div className="text-sm">
              <div className="text-muted-foreground mb-1">Input:</div>
              <ClickableJson json={part.state.input} onFileClick={onFileClick} />
            </div>
          )}
          {output && (
            <div className="text-sm">
              <div className="text-muted-foreground mb-1">Output:</div>
              <div className="relative">
                <BoundedPre
                  content={output}
                  className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
                />
                <CopyButton content={output} title="Copy output" className="absolute top-1 right-1" iconSize="sm" />
              </div>
            </div>
          )}
          {part.time.ran !== undefined && part.time.completed !== undefined && (
            <div className="text-xs text-muted-foreground">
              Duration: {((part.time.completed - part.time.ran) / 1000).toFixed(2)}s
            </div>
          )}
        </>
      )}

      {part.state.status === 'error' && (
        <div className="text-sm">
          <div className="text-destructive mb-1">Error:</div>
          <BoundedPre
            content={part.state.error.message}
            className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words text-destructive"
          />
        </div>
      )}
    </>
  )

  if (part.name === 'shell') {
    return (
      <div ref={outputRef} className={cn('my-1', isWaitingPermission && 'border-l-2 border-highlight pl-2')}>
        <ShellPreview
          command={displayCommand ?? ''}
          output={output}
          onClick={() => setDetailsOpen(!detailsOpen)}
          status={
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className={getStatusColor()}>{getStatusIcon()}</span>
              <span>{statusLabel}</span>
              {sandboxIndicator}
              {backgroundIndicator}
            </span>
          }
        />
        <ToolContentFiles part={part} className={TRANSCRIPT_DETAIL_CLASS} />
        <ToolDetails
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          title={`$ ${displayCommand ?? ''}`}
        >
          {detailContent}
        </ToolDetails>
      </div>
    )
  }

  return (
    <div ref={outputRef} className={cn('my-1', isWaitingPermission && 'border-l-2 border-highlight pl-2')}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className={cn(TRANSCRIPT_ROW_CLASS, 'group hover:text-foreground transition-colors')}
        >
          <span className={cn('shrink-0', getStatusColor())}>{getStatusIcon()}</span>
          <span className="shrink-0 font-medium text-foreground">{part.name}</span>
          {sandboxIndicator}
          {backgroundIndicator}

          {previewText && isFileTool ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                if (onFileClick && previewText) {
                  onFileClick(previewText)
                }
              }}
              className="min-w-0 truncate text-primary text-xs hover:text-primary-hover cursor-pointer underline decoration-dotted"
              title={`Click to open ${previewText}`}
            >
              {previewText}
            </span>
          ) : previewText ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">{previewText}</span>
          ) : null}

          <span className="ml-auto shrink-0 text-xs">{statusLabel}</span>
        </button>

        {openWalkthrough ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0"
            onClick={() => onOpenWalkthrough?.(openWalkthrough.source)}
          >
            Open walkthrough
          </Button>
        ) : null}
      </div>

      <ToolContentFiles part={part} className={TRANSCRIPT_DETAIL_CLASS} />

      <ToolDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={part.name + (previewText ? ` ${previewText}` : '')}
      >
        {detailContent}
      </ToolDetails>
    </div>
  )
})
