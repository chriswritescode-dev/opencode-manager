import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GitFlatFileItem } from './GitFlatFileItem'
import { cn } from '@/lib/utils'
import type { GitFileStatus, GitFileStatusType } from '@/types/git'
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from '@/lib/git-status-styles'

interface GitFlatFileListProps {
  files: GitFileStatus[]
  staged: boolean
  onSelect: (path: string, staged: boolean) => void
  onStage?: (paths: string[]) => void
  onUnstage?: (paths: string[]) => void
  onDiscard?: (paths: string[], staged: boolean) => void
  selectedFile?: string
}

interface GroupedFiles {
  status: GitFileStatusType
  files: GitFileStatus[]
}

const statusOrder: GitFileStatusType[] = ['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked']

export function GitFlatFileList({
  files,
  staged,
  onSelect,
  onStage,
  onUnstage,
  selectedFile,
}: GitFlatFileListProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GitFileStatusType>>(new Set())

  const filteredFiles = useMemo(() => {
    return files
  }, [files])

  const groupedFiles = useMemo(() => {
    const groups: GroupedFiles[] = []

    for (const status of statusOrder) {
      const statusFiles = filteredFiles.filter(f => f.status === status)
      if (statusFiles.length > 0) {
        groups.push({ status, files: statusFiles })
      }
    }

    return groups
  }, [filteredFiles])

  const toggleGroup = (status: GitFileStatusType) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  const handleStageFile = (path: string) => {
    onStage?.([path])
  }

  const handleUnstageFile = (path: string) => {
    onUnstage?.([path])
  }

  const handleStageAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onStage) {
      onStage(filteredFiles.map(f => f.path))
    }
  }

  const handleUnstageAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onUnstage) {
      onUnstage(filteredFiles.map(f => f.path))
    }
  }

  const handleDiscardAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDiscard) {
      onDiscard(filteredFiles.map(f => f.path), staged)
    }
  }

  if (filteredFiles.length === 0) {
    return null
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {staged ? 'Staged Changes' : 'Changes'} ({filteredFiles.length})
        </span>
        <div className="flex items-center gap-1">
          {onDiscard && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-rose-500 hover:text-rose-600"
              onClick={handleDiscardAll}
            >
              Discard All
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={staged ? handleUnstageAll : handleStageAll}
          >
            {staged ? (
              <>
                <Minus className="w-3 h-3 mr-1" />
                Unstage All
              </>
            ) : (
              <>
                <Plus className="w-3 h-3 mr-1" />
                Stage All
              </>
            )}
          </Button>
        </div>
      </div>

      {groupedFiles.map(({ status, files: groupFiles }) => {
        const isCollapsed = collapsedGroups.has(status)

        return (
          <div key={status}>
            <button
              className="flex items-center gap-1 px-2 py-1 w-full text-left hover:bg-accent rounded transition-colors"
              onClick={() => toggleGroup(status)}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              )}
              <span className={cn('text-xs font-medium', GIT_STATUS_COLORS[status])}>
                {GIT_STATUS_LABELS[status]}
              </span>
              <span className="text-xs text-muted-foreground">
                ({groupFiles.length})
              </span>
            </button>

            {!isCollapsed && (
              <div className="ml-4">
                {groupFiles.map(file => (
                  <GitFlatFileItem
                    key={file.path}
                    file={file}
                    isSelected={selectedFile === file.path}
                    onSelect={onSelect}
                    onStage={handleStageFile}
                    onUnstage={handleUnstageFile}
                    onDiscard={onDiscard ? ((path: string, staged: boolean) => onDiscard([path], staged)) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
