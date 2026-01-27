import { useNavigate } from 'react-router-dom'
import { useRecentSessions, type RecentSession } from '@/hooks/useRecentSessions'
import { Card } from '@/components/ui/card'
import { Clock, Loader2, FolderGit2, Activity, Circle, Hash } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface RecentSessionsProps {
  maxItems?: number
  onSessionClick?: (session: RecentSession) => void
}

function SessionStatusIndicator({ status }: { status?: 'idle' | 'busy' | 'retry' }) {
  if (status === 'busy') {
    return (
      <span className="flex items-center gap-1 text-blue-500">
        <Activity className="w-3 h-3 animate-pulse" />
        <span className="text-xs">Active</span>
      </span>
    )
  }
  if (status === 'retry') {
    return (
      <span className="flex items-center gap-1 text-amber-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-xs">Retrying</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Circle className="w-2 h-2 fill-current" />
      <span className="text-xs">Idle</span>
    </span>
  )
}

function getShortSessionId(id: string): string {
  if (id.startsWith('ses_')) {
    return id.slice(4, 12)
  }
  return id.slice(0, 8)
}

export function RecentSessions({ maxItems = 5, onSessionClick }: RecentSessionsProps) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useRecentSessions(8)

  const handleSessionClick = (session: RecentSession) => {
    if (onSessionClick) {
      onSessionClick(session)
    } else if (session.repoId) {
      navigate(`/repos/${session.repoId}/sessions/${session.id}`)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading recent sessions...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        Failed to load recent sessions
      </div>
    )
  }

  const sessions = data?.sessions.slice(0, maxItems) || []

  if (sessions.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No recent sessions in the last 8 hours
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <Card
          key={session.id}
          className="p-3 cursor-pointer transition-all hover:bg-accent hover:shadow-md"
          onClick={() => handleSessionClick(session)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                  <Hash className="w-3 h-3" />
                  {getShortSessionId(session.id)}
                </span>
                <SessionStatusIndicator status={session.status} />
              </div>
              {session.summary && (
                <p className="text-sm mt-1 line-clamp-2 text-foreground">
                  {session.summary}
                </p>
              )}
              {!session.summary && session.title && session.title !== 'Untitled Session' && (
                <p className="text-sm mt-1 line-clamp-1 text-muted-foreground italic">
                  {session.title}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {session.repoName && (
                  <span className="flex items-center gap-1">
                    <FolderGit2 className="w-3 h-3" />
                    <span className="truncate max-w-[200px]">{session.repoName}</span>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(session.time.updated), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
