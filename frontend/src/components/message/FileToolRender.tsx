import React, { useState } from 'react'
import type { FileDiffInfo, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { DiffStats } from './DiffStats'
import { CodePreview } from './CodePreview'
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

function PatchViewer({ patch }: { patch: string }) {
  const lines = patch.split('\n')

  return (
    <pre className="bg-accent p-2 text-xs overflow-x-auto">
      {lines.map((line, index) => {
        const tone = line.startsWith('@@')
          ? 'text-blue-600 dark:text-blue-400'
          : line.startsWith('+++') || line.startsWith('---')
            ? 'text-muted-foreground'
            : line.startsWith('+')
              ? 'text-green-600 dark:text-green-400'
              : line.startsWith('-')
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground'
        return <div key={index} className={tone}>{line || ' '}</div>
      })}
    </pre>
  )
}

interface FileToolRenderProps {
  part: SessionMessageAssistantTool
  filediff?: FileDiffInfo
  filePath?: string
  content?: string
  toolName: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
}

export function FileToolRender({ part, filediff, filePath, content, toolName, onFileClick }: FileToolRenderProps) {
  const { preferences } = useSettings()
  const isReadTool = toolName === 'Read'
  const isEditTool = toolName === 'Edit'
  const isWriteTool = toolName === 'Write'
  const hasExpandableContent = !isReadTool && (filediff || content)
  
  const isFileMutatingTool = isEditTool || isWriteTool
  const defaultExpanded = isFileMutatingTool
    ? (preferences?.expandDiffs ?? true)
    : (preferences?.expandToolCalls ?? false)
  const [expanded, setExpanded] = useState(defaultExpanded)

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

  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        onClick={() => hasExpandableContent && setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-card hover:bg-card-hover text-left flex items-center justify-between text-sm gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-green-600 dark:text-green-400 flex-shrink-0">✓</span>
          <span className="font-medium flex-shrink-0">{toolName}</span>
          {filePath && (
            <span 
              onClick={handleFileClick}
              className="text-blue-600 dark:text-blue-400 text-xs truncate hover:underline cursor-pointer"
            >
              {getRelativePath(filePath)}
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
      </button>

      {expanded && hasExpandableContent && (
        <div className="bg-card p-0">
          {filediff && <PatchViewer patch={filediff.patch} />}
          {content && !filediff && <CodePreview fileName={filePath || ''} content={content} />}
        </div>
      )}
    </div>
  )
}

function fileDiffs(part: SessionMessageAssistantTool): FileDiffInfo[] {
  if (part.state.status !== 'completed') return []
  const files = part.state.metadata?.files
  if (!Array.isArray(files)) return []
  return files.filter(isFileDiff)
}

export function getToolSpecificRender(part: SessionMessageAssistantTool, onFileClick?: (filePath: string) => void): React.ReactElement | null {
  if (part.state.status !== 'completed') return null

  const input = part.state.input
  const inputPath = typeof input.path === 'string' ? input.path : undefined

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
