import { useState } from 'react'
import { useGitStatus } from '@/api/git'
import { Loader2, FileText, FilePlus, FileX, FileEdit, File, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitFileStatus, GitFileStatusType } from '@/types/git'

interface GitChangesPanelProps {
  repoId: number
  onFileSelect: (path: string) => void
  selectedFile?: string
}

const statusConfig: Record<GitFileStatusType, { icon: typeof FileText; color: string; label: string }> = {
  modified: { icon: FileEdit, color: 'text-yellow-500', label: 'Modified' },
  added: { icon: FilePlus, color: 'text-green-500', label: 'Added' },
  deleted: { icon: FileX, color: 'text-red-500', label: 'Deleted' },
  renamed: { icon: FileText, color: 'text-blue-500', label: 'Renamed' },
  untracked: { icon: File, color: 'text-gray-400', label: 'Untracked' },
  copied: { icon: FileText, color: 'text-purple-500', label: 'Copied' },
}

function FileStatusItem({ file, isSelected, onClick }: { file: GitFileStatus; isSelected: boolean; onClick: () => void }) {
  const config = statusConfig[file.status]
  const Icon = config.icon
  const fileName = file.path.split('/').pop() || file.path
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-md',
        isSelected && 'bg-accent'
      )}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm text-foreground truncate">{fileName}</span>
          {file.staged && (
            <span className="text-[10px] px-1 py-0.5 bg-green-500/20 text-green-500 rounded">staged</span>
          )}
        </div>
        {dirPath && (
          <span className="text-xs text-muted-foreground truncate block">{dirPath}</span>
        )}
        {file.oldPath && (
          <span className="text-xs text-muted-foreground truncate block">← {file.oldPath}</span>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  )
}

export function GitChangesPanel({ repoId, onFileSelect, selectedFile }: GitChangesPanelProps) {
  const { data: status, isLoading, error } = useGitStatus(repoId)
  const [filter, setFilter] = useState<GitFileStatusType | 'all'>('all')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Failed to load git status</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!status || !status.hasChanges) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No uncommitted changes</p>
      </div>
    )
  }

  const filteredFiles = filter === 'all' 
    ? status.files 
    : status.files.filter(f => f.status === filter)

  const statusCounts = status.files.reduce((acc, file) => {
    acc[file.status] = (acc[file.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">{status.branch}</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status.ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="w-3 h-3" />
                {status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="w-3 h-3" />
                {status.behind}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'text-xs px-2 py-0.5 rounded transition-colors',
              filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            All ({status.files.length})
          </button>
          {Object.entries(statusCounts).map(([statusKey, count]) => {
            const config = statusConfig[statusKey as GitFileStatusType]
            return (
              <button
                key={statusKey}
                onClick={() => setFilter(statusKey as GitFileStatusType)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded transition-colors',
                  filter === statusKey ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <span className={config.color}>{config.label}</span> ({count})
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {filteredFiles.map((file) => (
            <FileStatusItem
              key={`${file.path}-${file.staged}`}
              file={file}
              isSelected={selectedFile === file.path}
              onClick={() => onFileSelect(file.path)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
