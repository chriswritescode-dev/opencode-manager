import { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Loader2 } from 'lucide-react'
import { toolContentText, type SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { useMobile } from '@/hooks/useMobile'
import { toolMetadata } from '@/lib/backgroundWork'
import { clampDisplayText } from '@/lib/clampDisplayText'
import { cn } from '@/lib/utils'
import { markdownRehypePlugins } from '@/lib/markdownRehypePlugins'
import { CopyButton } from '@/components/ui/copy-button'
import { FileReferenceText } from './FileReferenceText'
import { ToolContentFiles } from './ToolContentFiles'
import { ToolDetails, useToolDetailsState } from './ToolDetails'
import { TRANSCRIPT_DETAIL_CLASS, TRANSCRIPT_ROW_CLASS } from './transcriptStyles'

const PREVIEW_CALL_LIMIT = 5
const MOBILE_PREVIEW_CALL_LIMIT = 3

type ExecuteCallStatus = 'running' | 'completed' | 'error'

interface ExecuteCall {
  tool: string
  status: ExecuteCallStatus
  input?: Record<string, unknown>
}

interface ExecuteToolPartProps {
  part: SessionMessageAssistantTool
  isWaitingPermission: boolean
  onFileClick?: (filePath: string) => void
}

interface ParsedOutput {
  json: string
  rest?: string
}

const OUTPUT_TAIL_PATTERN = /\n\n(Warnings|Logs):\n/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!isRecord(call)) return []
    const tool = call.tool
    const status = call.status
    if (typeof tool !== 'string') return []
    if (status !== 'running' && status !== 'completed' && status !== 'error') return []
    return [{ tool, status, input: isRecord(call.input) ? call.input : undefined }]
  })
}

function primitiveInputSummary(input: Record<string, unknown>): string {
  const entries = Object.entries(input).filter(([, value]) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ))
  if (entries.length === 0) return ''
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')}]`
}

function executeCallSummary(call: ExecuteCall): string {
  const args = primitiveInputSummary(call.input ?? {}).replace(/\s+/g, ' ')
  return `${call.tool}${args ? ` ${args}` : ''}`
}

function executeCode(part: SessionMessageAssistantTool): string | undefined {
  if (part.state.status === 'streaming') return undefined
  const code = part.state.input.code
  return typeof code === 'string' && code ? code : undefined
}

function executeOutputText(part: SessionMessageAssistantTool): string {
  if (part.state.status === 'error') return part.state.error.message.trim()
  if (part.state.status !== 'completed') return ''
  return toolContentText(part.state.content).trim()
}

function parseOutput(text: string): ParsedOutput | undefined {
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined
  const tail = text.search(OUTPUT_TAIL_PATTERN)
  const json = tail === -1 ? text : text.slice(0, tail)
  try {
    JSON.parse(json)
  } catch {
    return undefined
  }
  return { json, rest: tail === -1 ? undefined : text.slice(json.length).trim() || undefined }
}

function trimTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, '')
}

function lineCount(text: string | undefined): number {
  return text ? trimTrailingNewlines(text).split('\n').length : 0
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function longestBacktickRun(text: string): number {
  const runs = text.match(/`+/g) ?? []
  return runs.reduce((longest, run) => Math.max(longest, run.length), 0)
}

const HighlightedCode = memo(function HighlightedCode({
  content,
  language,
  digits,
}: {
  content: string
  language: 'ts' | 'json'
  digits: number
}) {
  const body = trimTrailingNewlines(content)
  const markdown = useMemo(() => {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1))
    return `${fence}${language}\n${body}\n${fence}`
  }, [body, language])
  const gutter = useMemo(
    () => body.split('\n').map((_, index) => String(index + 1)).join('\n'),
    [body],
  )

  return (
    <div className="flex items-start gap-3 overflow-x-auto rounded bg-accent p-2 font-mono text-xs leading-5">
      <div
        className="shrink-0 select-none whitespace-pre text-right text-muted-foreground"
        style={{ width: `${digits}ch` }}
        data-testid="execute-line-numbers"
      >
        {gutter}
      </div>
      <div className="min-w-fit [&_.hljs]:overflow-visible [&_.hljs]:bg-transparent [&_.hljs]:p-0 [&_code]:bg-transparent [&_code]:p-0 [&_pre]:m-0 [&_pre]:whitespace-pre [&_pre]:bg-transparent">
        <ReactMarkdown rehypePlugins={markdownRehypePlugins}>{markdown}</ReactMarkdown>
      </div>
    </div>
  )
})

function ExecuteCallRow({ call, onFileClick }: { call: ExecuteCall; onFileClick?: (filePath: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(call.input ?? {})
  const expandable = entries.length > 0
  const isError = call.status === 'error'
  const color = isError ? 'text-destructive' : 'text-muted-foreground'

  const summary = (
    <>
      <span className="shrink-0">{isError ? '✗' : '›'}</span>
      <span className="min-w-0 truncate">{executeCallSummary(call)}</span>
    </>
  )

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className={`flex w-full min-w-0 items-center gap-1 text-left font-mono text-xs hover:text-foreground ${color}`}
          title={executeCallSummary(call)}
        >
          {summary}
        </button>
      ) : (
        <div className={`flex min-w-0 items-center gap-1 font-mono text-xs ${color}`}>{summary}</div>
      )}
      {expanded && (
        <div className={`mt-1 space-y-1 border-l border-border pl-3 text-xs ${isError ? 'text-destructive' : 'text-foreground'}`}>
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">{key}:</span>
              <span className="whitespace-pre-wrap break-words">
                <FileReferenceText
                  text={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                  onFileClick={onFileClick}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ExecuteToolPart({ part, isWaitingPermission, onFileClick }: ExecuteToolPartProps) {
  const { preferences } = useSettings()
  const [detailsOpen, setDetailsOpen] = useToolDetailsState(preferences?.expandToolCalls ?? false)
  const previewCallLimit = useMobile() ? MOBILE_PREVIEW_CALL_LIMIT : PREVIEW_CALL_LIMIT
  const metadata = toolMetadata(part)
  const calls = executeCalls(metadata.toolCalls)
  const code = executeCode(part)
  const output = executeOutputText(part)
  const displayOutput = useMemo(() => clampDisplayText(output), [output])
  const parsedOutput = useMemo(
    () => (displayOutput === output ? parseOutput(output) : undefined),
    [displayOutput, output],
  )
  const failed = part.state.status === 'error'
    || metadata.error === true
    || (part.state.status === 'completed' && calls.some((call) => call.status === 'error'))
  const status = part.state.status

  const statusLabel = (() => {
    if (status === 'streaming') return 'Receiving code…'
    if (isWaitingPermission) return 'awaiting permission'
    if (status === 'running') return 'Running'
    const duration = part.time.completed !== undefined
      ? ` · ${formatDuration(part.time.completed - (part.time.ran ?? part.time.created))}`
      : ''
    return `${failed ? 'Failed' : 'Completed'}${duration}`
  })()

  const statusColor = (() => {
    if (status === 'error') return 'text-destructive'
    if (status === 'running') return isWaitingPermission ? 'text-highlight' : 'text-warning'
    if (failed) return 'text-destructive'
    if (status === 'completed') return 'text-success'
    return 'text-muted-foreground'
  })()

  const statusIcon = (() => {
    if (status === 'streaming') {
      return <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
    }
    if (status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin" />
    if (failed) return <span>✗</span>
    if (status === 'completed') return <span>✓</span>
    return <span>○</span>
  })()

  const digits = String(Math.max(lineCount(code), lineCount(parsedOutput?.json), 1)).length
  const errorPreview = failed && output ? output.split('\n').slice(0, 4) : []

  return (
    <div className={cn('my-1', isWaitingPermission && 'border-l-2 border-highlight pl-2')}>
      <button
        type="button"
        onClick={() => setDetailsOpen(!detailsOpen)}
        aria-expanded={detailsOpen}
        className={cn(TRANSCRIPT_ROW_CLASS, 'group hover:text-foreground transition-colors')}
      >
        <span className={cn('shrink-0', statusColor)}>{statusIcon}</span>
        <span className="shrink-0 font-medium text-foreground">execute</span>
        <span className={cn('ml-auto shrink-0 text-xs', failed && 'text-destructive')}>
          {statusLabel}
        </span>
      </button>

      {!detailsOpen && calls.length > 0 && (
        <div className={cn(TRANSCRIPT_DETAIL_CLASS, 'space-y-0.5')}>
          {calls.slice(0, previewCallLimit).map((call, index) => (
            <ExecuteCallRow key={`${call.tool}-${index}`} call={call} onFileClick={onFileClick} />
          ))}
          {calls.length > previewCallLimit && (
            <div className="text-xs text-muted-foreground">({calls.length - previewCallLimit} more calls)</div>
          )}
        </div>
      )}

      <ToolContentFiles part={part} className={TRANSCRIPT_DETAIL_CLASS} />

      {!detailsOpen && errorPreview.length > 0 && (
        <div className={cn(TRANSCRIPT_DETAIL_CLASS, 'font-mono text-xs text-destructive')}>
          {errorPreview.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-words">
              {index === 0 ? `↳ ${line}` : `  ${line}`}
            </div>
          ))}
        </div>
      )}

      <ToolDetails open={detailsOpen} onOpenChange={setDetailsOpen} title="execute">
        {calls.length > 0 && (
          <div className="space-y-0.5">
            {calls.map((call, index) => (
              <ExecuteCallRow key={`${call.tool}-${index}`} call={call} onFileClick={onFileClick} />
            ))}
          </div>
        )}

        <div className="text-sm">
          <div className="text-muted-foreground mb-1">Code</div>
          {code ? (
            <HighlightedCode content={code} language="ts" digits={digits} />
          ) : (
            <div className="text-xs text-muted-foreground">Waiting for code…</div>
          )}
        </div>

        <div className="text-sm">
          <div className="text-muted-foreground mb-1">Output</div>
          {parsedOutput ? (
            <>
              <HighlightedCode content={parsedOutput.json} language="json" digits={digits} />
              {parsedOutput.rest && (
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">
                  {parsedOutput.rest}
                </pre>
              )}
            </>
          ) : displayOutput ? (
            <pre
              className={`whitespace-pre-wrap break-words text-xs ${failed ? 'text-destructive' : 'text-foreground'}`}
            >
              {displayOutput}
            </pre>
          ) : (
            <div className="text-xs text-muted-foreground">
              {status === 'completed' ? 'No output' : 'Waiting for output…'}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {code && (
            <div className="flex items-center gap-1">
              <CopyButton content={code} title="Copy code" />
              <span className="text-xs text-muted-foreground">Copy code</span>
            </div>
          )}
          {output && (
            <div className="flex items-center gap-1">
              <CopyButton content={output} title="Copy output" />
              <span className="text-xs text-muted-foreground">Copy output</span>
            </div>
          )}
        </div>
      </ToolDetails>
    </div>
  )
}
