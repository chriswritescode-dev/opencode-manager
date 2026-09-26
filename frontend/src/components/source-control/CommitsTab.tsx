import { useGitLog } from '@/api/git'
import { Loader2, GitCommit, AlertCircle, ArrowUp } from 'lucide-react'
import { cn, formatShortRelativeTime } from '@/lib/utils'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'

interface CommitsTabProps {
  repoId: number
  branch: string
  onSelectCommit?: (hash: string) => void
}

export function CommitsTab({ repoId, branch, onSelectCommit }: CommitsTabProps) {
  const { data, isLoading, error } = useGitLog(repoId, 50, branch)

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
    <div className="flex flex-col h-full overflow-x-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
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
              <p className="text-sm font-medium line-clamp-2">{commit.message}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground overflow-hidden">
                <span className="font-mono">{commit.hash.substring(0, 7)}</span>
                <span>·</span>
                <span className="truncate">{commit.authorName}</span>
                <span>·</span>
                <span className="flex-shrink-0">{formatShortRelativeTime(new Date(parseInt(commit.date, 10) * 1000))}</span>
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
