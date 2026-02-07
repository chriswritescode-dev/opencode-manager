import { Button } from '@/components/ui/button'
import { Plus, Minus, FileText, FilePlus, FileX, FileSearch, CircleDot, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitFileStatus } from '@/types/git'
import { GIT_STATUS_COLORS, GIT_UI_COLORS } from '@/lib/git-status-styles'

interface GitFlatFileItemProps {
  file: GitFileStatus
  isSelected: boolean
  onSelect: (path: string, staged: boolean) => void
  onStage?: (path: string) => void
  onUnstage?: (path: string) => void
  onDiscard?: (path: string, staged: boolean) => void
}

const statusIcons = {
  modified: FileSearch,
  added: FilePlus,
  deleted: FileX,
  renamed: FileSearch,
  untracked: CircleDot,
  copied: FilePlus,
}

export function GitFlatFileItem({ file, isSelected, onSelect, onStage, onUnstage, onDiscard }: GitFlatFileItemProps) {
  const StatusIcon = statusIcons[file.status] || FileText
  const statusColor = GIT_STATUS_COLORS[file.status] || 'text-muted-foreground'

  const fileName = file.path.split('/').pop() || file.path
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (file.staged && onUnstage) {
      onUnstage(file.path)
    } else if (!file.staged && onStage) {
      onStage(file.path)
    }
  }

  const handleDiscard = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDiscard) {
      onDiscard(file.path, file.staged)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-accent transition-colors',
        isSelected && 'bg-accent'
      )}
      onClick={() => onSelect(file.path, file.staged)}
    >
      <StatusIcon className={cn('w-4 h-4 flex-shrink-0', statusColor)} />
      <div className="flex-1 min-w-0 flex items-center gap-1">
        <span className="text-sm truncate">{fileName}</span>
        {dirPath && (
          <span className="text-xs text-muted-foreground truncate">
            {dirPath}
          </span>
        )}
      </div>
      {file.staged && (
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded flex-shrink-0', GIT_UI_COLORS.stagedBadge)}>
          staged
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={handleAction}
      >
        {file.staged ? (
          <Minus className={cn('w-3 h-3', GIT_UI_COLORS.unstage)} />
        ) : (
          <Plus className={cn('w-3 h-3', GIT_UI_COLORS.stage)} />
        )}
      </Button>
      {onDiscard && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={handleDiscard}
          title="Discard changes"
        >
          <RotateCcw className="w-3 h-3 text-rose-500" />
        </Button>
      )}
    </div>
  )
}
