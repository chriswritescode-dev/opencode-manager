import React, { useMemo } from 'react'
import type { FileDiffInfo, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { useMobile } from '@/hooks/useMobile'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { DiffStats } from './DiffStats'
import { CodePreview, detectLanguage } from './CodePreview'
import { DiffLines } from './DiffLines'
import { ToolContentFiles } from './ToolContentFiles'
import { ToolDetails, useToolDetailsState } from './ToolDetails'
import { TRANSCRIPT_DETAIL_CLASS, TRANSCRIPT_ROW_CLASS } from './transcriptStyles'
import { parseUnifiedDiff } from '@/lib/diffLines'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp } from 'lucide-react'

function isFileDiff(data: unknown): data is FileDiffInfo {
  return (
    typeof data === 'object' &&
    data !== null &&
    'file' in data &&
    'patch' in data &&
    'additions' in data &&
    'deletions' in data &&
    typeof (data as FileDiffInfo).file === 'string' &&
    typeof (data as FileDiffInfo).patch === 'string' &&
    typeof (data as FileDiffInfo).additions === 'number' &&
    typeof (data as FileDiffInfo).deletions === 'number'
  )
}

export function getRelativePath(filePath: string): string {
  const reposIndex = filePath.indexOf('/repos/')
  if (reposIndex !== -1) {
    return filePath.substring(reposIndex + 7)
  }
  
  const workspaceIndex = filePath.indexOf('/workspace/')
  if (workspaceIndex !== -1) {
    return filePath.substring(workspaceIndex + 11)
  }

  if (filePath.startsWith('/Users/') || filePath.startsWith('/home/')) {
    const parts = filePath.split('/')
    const lastThree = parts.slice(-3)
    return lastThree.join('/')
  }

  return filePath
}

const PATCH_PREVIEW_LINE_COUNT = 8
const MOBILE_PATCH_PREVIEW_LINE_COUNT = 4

interface FileToolRenderProps {
  part: SessionMessageAssistantTool
  filediff?: FileDiffInfo
  filePath?: string
  content?: string
  toolName: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
}

function FileToolRender({ part, filediff, filePath, content, toolName, onFileClick }: FileToolRenderProps) {
  const { preferences } = useSettings()
  const isMobile = useMobile()
  const isRemoteServer = !isLocalOpenCodeServer(useOpenCodeServerId())
  const isReadTool = toolName === 'Read'
  const hasDiff = Boolean(filediff)
  const hasExpandableContent = !isReadTool && (filediff || content)
  const isFileLink = Boolean(onFileClick) && !isRemoteServer

  const defaultExpanded = hasDiff
    ? (preferences?.expandDiffs ?? true)
    : (preferences?.expandToolCalls ?? false)
  const [detailsOpen, setDetailsOpen] = useToolDetailsState(defaultExpanded)
  const relativePath = filePath ? getRelativePath(filePath) : undefined
  const detailsTitle = relativePath ? `${toolName} ${relativePath}` : toolName
  const diffRows = useMemo(() => (filediff ? parseUnifiedDiff(filediff.patch) : []), [filediff])
  const language = useMemo(() => detectLanguage(filePath ?? ''), [filePath])
  const previewLineCount = isMobile ? MOBILE_PATCH_PREVIEW_LINE_COUNT : PATCH_PREVIEW_LINE_COUNT
  const previewRows = diffRows.slice(0, previewLineCount)
  const hiddenLineCount = diffRows.length - previewRows.length

  const getDuration = () => {
    if (part.time.ran === undefined || part.time.completed === undefined) return ''
    return ((part.time.completed - part.time.ran) / 1000).toFixed(2) + 's'
  }

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onFileClick && filePath) {
      onFileClick(filePath)
    }
  }

  const pathLabel = relativePath && (
    isFileLink ? (
      <span
        onClick={handleFileClick}
        className="min-w-0 truncate text-primary text-xs hover:underline cursor-pointer"
      >
        {relativePath}
      </span>
    ) : (
      <span className="min-w-0 truncate text-muted-foreground text-xs">{relativePath}</span>
    )
  )

  if (filediff) {
    return (
      <>
        <div className="my-1 w-full bg-muted px-3 py-2 md:px-4 md:py-3">
          <button
            type="button"
            onClick={() => hasExpandableContent && setDetailsOpen(!detailsOpen)}
            aria-label={relativePath ? `${toolName} ${relativePath}` : toolName}
            className="flex w-full min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground text-left transition-colors hover:text-foreground"
          >
            <span className="flex-shrink-0">←</span>
            <span className="flex-shrink-0 font-medium text-foreground">{toolName}</span>
            {pathLabel}
            <span className="ml-auto flex flex-shrink-0 items-center gap-2">
              <DiffStats additions={filediff.additions} deletions={filediff.deletions} />
              <span className="text-muted-foreground text-xs">{getDuration()}</span>
              {detailsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </span>
          </button>

          {!detailsOpen && previewRows.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                aria-label={`Show diff for ${relativePath ?? toolName}`}
                className="block w-full text-left"
              >
                <DiffLines rows={previewRows} language={language} />
              </button>
              {hiddenLineCount > 0 && (
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                >
                  ({hiddenLineCount} more lines)
                </button>
              )}
            </div>
          )}

          {detailsOpen && !isMobile && (
            <div className="mt-1">
              <DiffLines rows={diffRows} language={language} />
            </div>
          )}

          {isMobile && (
            <ToolDetails open={detailsOpen} onOpenChange={setDetailsOpen} title={detailsTitle}>
              <DiffLines rows={diffRows} language={language} />
            </ToolDetails>
          )}
        </div>

        <ToolContentFiles part={part} className={TRANSCRIPT_DETAIL_CLASS} />
      </>
    )
  }

  return (
    <div className="my-1">
      <button
        onClick={() => hasExpandableContent && setDetailsOpen(!detailsOpen)}
        className={cn(TRANSCRIPT_ROW_CLASS, 'group hover:text-foreground transition-colors')}
      >
        <span className="flex-shrink-0 text-success">✓</span>
        <span className="flex-shrink-0 font-medium text-foreground">{toolName}</span>
        {pathLabel}
        <span className="ml-auto flex flex-shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{getDuration()}</span>
          {hasExpandableContent && (
            detailsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </span>
      </button>

      <ToolContentFiles part={part} className={TRANSCRIPT_DETAIL_CLASS} />

      {hasExpandableContent && (
        <ToolDetails open={detailsOpen} onOpenChange={setDetailsOpen} title={detailsTitle}>
          {content && <CodePreview fileName={filePath || ''} content={content} />}
        </ToolDetails>
      )}
    </div>
  )
}

function fileDiffs(part: SessionMessageAssistantTool): FileDiffInfo[] {
  if (part.state.status !== 'completed') return []
  const metadata = part.state.metadata
  const files: unknown[] = Array.isArray(metadata?.files) ? metadata.files : [metadata?.filediff]
  return files.filter(isFileDiff)
}

/** Returns the file path a file tool was called with, accepting both the `path` and legacy `filePath` input keys. */
export function getToolInputPath(input: Record<string, unknown> | undefined): string | undefined {
  const path = input?.path
  if (typeof path === 'string' && path) return path
  const filePath = input?.filePath
  return typeof filePath === 'string' && filePath ? filePath : undefined
}

export function getToolSpecificRender(part: SessionMessageAssistantTool, onFileClick?: (filePath: string) => void): React.ReactElement | null {
  if (part.state.status !== 'completed') return null

  const input = part.state.input
  const inputPath = getToolInputPath(input)

  if (part.name === 'edit' || part.name === 'patch') {
    const diffs = fileDiffs(part)
    if (diffs.length === 0) return null
    const toolName = part.name === 'edit' ? 'Edit' : 'Patch'
    return (
      <>
        {diffs.map((filediff, index) => (
          <FileToolRender
            key={`${filediff.file}-${index}`}
            part={part}
            filediff={filediff}
            filePath={filediff.file}
            toolName={toolName}
            onFileClick={onFileClick}
          />
        ))}
      </>
    )
  }

  if (part.name === 'write' && inputPath) {
    const content = input.content as string | undefined
    return <FileToolRender part={part} filePath={inputPath} content={content} toolName="Write" onFileClick={onFileClick} />
  }

  if (part.name === 'read' && inputPath) {
    return <FileToolRender part={part} filePath={inputPath} toolName="Read" onFileClick={onFileClick} />
  }

  return null
}
