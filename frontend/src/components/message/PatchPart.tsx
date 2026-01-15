import { useState } from 'react'
import type { components } from '@/api/opencode-types'
import { getRelativePath } from './FileToolRender'
import { ChevronDown, ChevronUp } from 'lucide-react'

type PatchPartType = components['schemas']['PatchPart']

interface PatchPartProps {
  part: PatchPartType
  onFileClick?: (filePath: string) => void
}

const INITIAL_FILES_SHOWN = 3

export function PatchPart({ part, onFileClick }: PatchPartProps) {
  const [expanded, setExpanded] = useState(false)

  const hasMoreFiles = part.files.length > INITIAL_FILES_SHOWN
  const displayedFiles = expanded ? part.files : part.files.slice(0, INITIAL_FILES_SHOWN)
  const hiddenCount = part.files.length - INITIAL_FILES_SHOWN

  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-card hover:bg-card-hover text-left flex items-center justify-between text-sm gap-2"
      >
        <span className="font-medium">
          File Changes ({part.files.length} file{part.files.length !== 1 ? 's' : ''})
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-muted-foreground text-xs font-mono">{part.hash.slice(0, 8)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <div className="bg-card px-3 py-2 space-y-1">
        {displayedFiles.map((file, index) => (
          <div
            key={index}
            className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            onClick={() => onFileClick?.(file)}
          >
            {getRelativePath(file)}
          </div>
        ))}

        {!expanded && hasMoreFiles && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
          >
            <ChevronDown className="w-3 h-3" />
            +{hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}
          </button>
        )}

        {expanded && hasMoreFiles && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
          >
            <ChevronUp className="w-3 h-3" />
            Show less
          </button>
        )}
      </div>
    </div>
  )
}