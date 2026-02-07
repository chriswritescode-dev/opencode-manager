import { useGitLog } from '@/api/git'
import { Loader2, GitCommit, AlertCircle, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'

interface CommitsTabProps {
  repoId: number
  onSelectCommit?: (hash: string) => void
  branch?: string
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(parseInt(timestamp, 10) * 1000)

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 4) return `${diffWeeks}w ago`
  return `${diffMonths}mo ago`
}

export function CommitsTab({ repoId, onSelectCommit, branch }: CommitsTabProps) {
  const { data, isLoading, error } = useGitLog(repoId, 50)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Failed to load commits</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!data?.commits || data.commits.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <GitCommit className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No commits found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {branch && (
        <div className="px-3 py-2 border-b border-border bg-muted/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Branch:</span>
            <span className="text-sm font-mono text-foreground">{branch}</span>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {data.commits.map((commit) => (
          <button
            key={commit.hash}
            className="flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors border-b border-border last:border-0"
            onClick={() => onSelectCommit?.(commit.hash)}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center mt-0.5">
              <GitCommit className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{commit.message}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{commit.hash.substring(0, 7)}</span>
                <span>·</span>
                <span className="truncate">{commit.authorName}</span>
                <span>·</span>
                <span className="flex-shrink-0">{formatRelativeTime(commit.date)}</span>
                {commit.unpushed && (
                  <span className={cn('flex items-center gap-0.5 px-1 rounded', GIT_UI_COLORS.unpushed)}>
                    <ArrowUp className="w-3 h-3" />
                    Local
                  </span>
                )}
                {!commit.unpushed && (
                  <span className={cn('flex items-center gap-0.5 px-1 rounded', GIT_UI_COLORS.pushed)}>
                    Remote
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
