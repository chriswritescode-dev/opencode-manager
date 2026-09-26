import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getRelativePath } from './FileToolRender'

interface StepFileChangesProps {
  files: string[]
  snapshot?: string
  onFileClick?: (filePath: string) => void
}

const INITIAL_FILES_SHOWN = 3

function fileNoun(count: number): string {
  return count === 1 ? 'file' : 'files'
}

export function StepFileChanges({ files, snapshot, onFileClick }: StepFileChangesProps) {
  const [expanded, setExpanded] = useState(false)

  if (files.length === 0) return null

  const hasMoreFiles = files.length > INITIAL_FILES_SHOWN
  const displayedFiles = expanded ? files : files.slice(0, INITIAL_FILES_SHOWN)
  const hiddenCount = files.length - INITIAL_FILES_SHOWN

  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        type="button"
        onClick={() => hasMoreFiles && setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-card hover:bg-card-hover text-left flex items-center justify-between text-sm gap-2"
      >
        <span className="font-medium">File Changes ({files.length} {fileNoun(files.length)})</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {snapshot && <span className="text-muted-foreground text-xs font-mono">{snapshot.slice(0, 8)}</span>}
          {hasMoreFiles && (
            expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      <div className="bg-card px-3 py-2 space-y-1">
        {displayedFiles.map((file) => (
          <button
            key={file}
            type="button"
            title={file}
            onClick={() => onFileClick?.(file)}
            className="block max-w-full truncate text-left text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {getRelativePath(file)}
          </button>
        ))}

        {hasMoreFiles && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Show less' : `+${hiddenCount} more ${fileNoun(hiddenCount)}`}
          </button>
        )}
      </div>
    </div>
  )
}
