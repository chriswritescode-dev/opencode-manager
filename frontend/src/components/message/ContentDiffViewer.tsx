import { useState } from 'react'
import { useMobile } from '@/hooks/useMobile'
import { Plus, Minus, ChevronDown, ChevronUp } from 'lucide-react'
import { diffLines } from 'diff'
import type { Change } from 'diff'
import { cn } from '@/lib/utils'

interface ContentDiffViewerProps {
  before: string
  after: string
}

const CONTEXT_LINES = 1
const MAX_LINE_DISPLAY_LENGTH = 200

interface DiffLineEntry {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_DISPLAY_LENGTH) {
    return line
  }
  return line.substring(0, MAX_LINE_DISPLAY_LENGTH) + '...'
}

export function ContentDiffViewer({ before, after }: ContentDiffViewerProps) {
  const isMobile = useMobile()
  const [showMore, setShowMore] = useState(false)

  const computeDiffLines = (): DiffLineEntry[] => {
    const difference = diffLines(before, after, {
      ignoreWhitespace: false,
    })

    const result: DiffLineEntry[] = []
    let oldLine = 0
    let newLine = 0

    difference.forEach((change: Change) => {
      const lines = change.value.split('\n')
      if (lines[lines.length - 1] === '') {
        lines.pop()
      }
      
      lines.forEach((line) => {
        if (change.added) {
          newLine++
          result.push({
            type: 'add',
            content: line,
            newLineNumber: newLine,
          })
        } else if (change.removed) {
          oldLine++
          result.push({
            type: 'remove',
            content: line,
            oldLineNumber: oldLine,
          })
        } else {
          oldLine++
          newLine++
          result.push({
            type: 'context',
            content: line,
            oldLineNumber: oldLine,
            newLineNumber: newLine,
          })
        }
      })
    })

    return result
  }

  const getCompressedDiff = (allLines: DiffLineEntry[]): DiffLineEntry[] => {
    const changedIndices = new Set<number>()
    
    allLines.forEach((line, index) => {
      if (line.type === 'add' || line.type === 'remove') {
        for (let i = Math.max(0, index - CONTEXT_LINES); i <= Math.min(allLines.length - 1, index + CONTEXT_LINES); i++) {
          changedIndices.add(i)
        }
      }
    })

    return allLines.filter((_, index) => changedIndices.has(index))
  }

  const allLines = computeDiffLines()
  const compressedLines = getCompressedDiff(allLines)
  
  const displayedLines = showMore ? allLines : compressedLines
  const hiddenCount = allLines.length - compressedLines.length

  if (compressedLines.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No changes
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-background">
      <div className="overflow-y-auto max-h-48">
        {displayedLines.map((line, index) => {
          const isAdd = line.type === 'add'
          const isRemove = line.type === 'remove'

          return (
            <div
              key={index}
              className={cn(
                'flex font-mono text-xs',
                isAdd && 'bg-green-500/10',
                isRemove && 'bg-red-500/10',
              )}
            >
              {!isMobile && (
                <div className="flex-shrink-0 w-14 flex text-muted-foreground/50 text-[10px]">
                  <span className="w-7 px-1 text-right">
                    {line.oldLineNumber || ''}
                  </span>
                  <span className="w-7 px-1 text-right">
                    {line.newLineNumber || ''}
                  </span>
                </div>
              )}
              <div className="w-4 flex-shrink-0 flex items-center justify-center">
                {isAdd && <Plus className="w-2.5 h-2.5 text-green-500" />}
                {isRemove && <Minus className="w-2.5 h-2.5 text-red-500" />}
              </div>
              <pre
                className={cn(
                  'flex-1 px-1 py-0.5 whitespace-pre-wrap break-all',
                  isAdd && 'text-green-600 dark:text-green-400',
                  isRemove && 'text-red-600 dark:text-red-400',
                )}
              >
                {truncateLine(line.content)}
              </pre>
            </div>
          )
        })}
      </div>

      {!showMore && hiddenCount > 0 && (
        <button
          onClick={() => setShowMore(true)}
          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronDown className="w-3 h-3" />
          +{hiddenCount} more lines
        </button>
      )}

      {showMore && hiddenCount > 0 && (
        <button
          onClick={() => setShowMore(false)}
          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronUp className="w-3 h-3" />
          Show less
        </button>
      )}
    </div>
  )
}