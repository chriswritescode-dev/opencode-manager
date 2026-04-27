import React, { useState } from 'react'
import type { components } from '@/api/opencode-types'
import { useSettings } from '@/hooks/useSettings'
import { DiffStats } from './DiffStats'
import { ContentDiffViewer } from './ContentDiffViewer'
import { CodePreview } from './CodePreview'
import { ChevronDown, ChevronUp } from 'lucide-react'

type ToolPart = components['schemas']['ToolPart']

export interface FileDiffData {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

function isFileDiff(data: unknown): data is FileDiffData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'file' in data &&
    'before' in data &&
    'after' in data &&
    'additions' in data &&
    'deletions' in data &&
    typeof (data as FileDiffData).file === 'string' &&
    typeof (data as FileDiffData).before === 'string' &&
    typeof (data as FileDiffData).after === 'string' &&
    typeof (data as FileDiffData).additions === 'number' &&
    typeof (data as FileDiffData).deletions === 'number'
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

function getFileName(filePath: string): string {
  const normalizedPath = filePath.replace(/\/+$/, '')
  return normalizedPath.split('/').pop() || filePath
}

interface FileToolRenderProps {
  part: ToolPart
  filediff?: FileDiffData
  filePath?: string
  content?: string
  toolName: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  messageMeta?: {
    model: string
    time?: number
  }
}

export function FileToolRender({ part, filediff, filePath, content, toolName, onFileClick, messageMeta }: FileToolRenderProps) {
  const { preferences } = useSettings()
  const isEditTool = toolName === 'Edit'
  const isWriteTool = toolName === 'Write'
  const hasExpandableContent = Boolean(filediff || content)
  
  const isFileMutatingTool = isEditTool || isWriteTool
  const defaultExpanded = isFileMutatingTool
    ? (preferences?.expandDiffs ?? true)
    : (preferences?.expandToolCalls ?? false)
  const [expanded, setExpanded] = useState(defaultExpanded)

  const getDuration = () => {
    if (part.state.status === 'completed' && part.state.time) {
      return ((part.state.time.end - part.state.time.start) / 1000).toFixed(2) + 's'
    }
    return ''
  }

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onFileClick && filePath) {
      onFileClick(filePath)
    }
  }

  return (
    <div className="border border-orange-500/20 rounded-lg overflow-hidden my-2 bg-orange-500/5">
      <button
        onClick={() => hasExpandableContent && setExpanded(!expanded)}
        className="w-full px-3 py-2 hover:bg-orange-500/10 text-left text-sm transition-colors"
      >
        {messageMeta && (
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{messageMeta.model}</span>
            {messageMeta.time && <span>{new Date(messageMeta.time).toLocaleTimeString()}</span>}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-orange-600 dark:text-orange-400 flex-shrink-0">✓</span>
            <span className="font-medium flex-shrink-0">{toolName}</span>
            {filePath && (
              <span 
                onClick={handleFileClick}
                className="text-orange-600 dark:text-orange-400 text-xs truncate hover:underline cursor-pointer"
                title={getRelativePath(filePath)}
              >
                {getFileName(filePath)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {filediff && <DiffStats additions={filediff.additions} deletions={filediff.deletions} />}
            <span className="text-muted-foreground text-xs">{getDuration()}</span>
            {hasExpandableContent && (
              expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </button>

      {expanded && hasExpandableContent && (
        <div className="bg-card p-0">
          {filediff && <ContentDiffViewer before={filediff.before} after={filediff.after} />}
          {content && !filediff && <CodePreview fileName={filePath || ''} content={content} />}
        </div>
      )}
    </div>
  )
}

export function getToolSpecificRender(part: ToolPart, onFileClick?: (filePath: string) => void, messageMeta?: FileToolRenderProps['messageMeta']): React.ReactElement | null {
  if (part.state.status !== 'completed') return null

  if (part.tool === 'edit') {
    const filediff = part.state.metadata?.filediff
    const filePath = part.state.input?.filePath as string | undefined
    if (filediff && isFileDiff(filediff)) {
      return <FileToolRender part={part} filediff={filediff} filePath={filePath} toolName="Edit" onFileClick={onFileClick} messageMeta={messageMeta} />
    }
  }

  if (part.tool === 'write') {
    const filePath = part.state.input?.filePath as string | undefined
    const content = part.state.input?.content as string | undefined
    if (filePath) {
      return <FileToolRender part={part} filePath={filePath} content={content} toolName="Write" onFileClick={onFileClick} messageMeta={messageMeta} />
    }
  }

  if (part.tool === 'read') {
    const filePath = part.state.input?.filePath as string | undefined
    if (filePath) {
      return <FileToolRender part={part} filePath={filePath} content={part.state.output} toolName="Read" onFileClick={onFileClick} messageMeta={messageMeta} />
    }
  }

  return null
}
