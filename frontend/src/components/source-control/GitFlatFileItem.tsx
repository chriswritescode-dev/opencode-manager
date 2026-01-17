import { Button } from '@/components/ui/button'
import { Plus, Minus, FileText, FilePlus, FileX, FileSearch, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitFileStatus } from '@/types/git'

interface GitFlatFileItemProps {
  file: GitFileStatus
  isSelected: boolean
  onSelect: (path: string) => void
  onStage?: (path: string) => void
  onUnstage?: (path: string) => void
}

const statusIcons = {
  modified: FileSearch,
  added: FilePlus,
  deleted: FileX,
  renamed: FileSearch,
  untracked: CircleDot,
  copied: FilePlus,
}

const statusColors = {
  modified: 'text-yellow-500',
  added: 'text-green-500',
  deleted: 'text-red-500',
  renamed: 'text-blue-500',
  untracked: 'text-gray-400',
  copied: 'text-green-500',
}

export function GitFlatFileItem({ file, isSelected, onSelect, onStage, onUnstage }: GitFlatFileItemProps) {
  const StatusIcon = statusIcons[file.status] || FileText
  const statusColor = statusColors[file.status] || 'text-muted-foreground'

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

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-accent/50 transition-colors',
        isSelected && 'bg-accent'
      )}
      onClick={() => onSelect(file.path)}
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
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 flex-shrink-0">
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
          <Minus className="w-3 h-3 text-red-500" />
        ) : (
          <Plus className="w-3 h-3 text-green-500" />
        )}
      </Button>
    </div>
  )
}
