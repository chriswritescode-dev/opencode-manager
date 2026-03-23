import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link, useNavigate } from 'react-router-dom'
import { Play, Square, RotateCw, Trash2, ExternalLink, Loader2, ArrowUpRight } from 'lucide-react'
import type { SessionDetail, SessionStatus } from '@opencode-manager/shared'
import { formatDistanceToNow } from 'date-fns'
import { showToast } from '@/lib/toast'
import { OpenCodeClient } from '@/api/opencode'
import { getSessionOpenCodeEndpoint } from '@/config'

interface SessionManagerCardProps {
  session: SessionDetail
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onDelete: (id: string) => void
  onViewRequests: (id: string) => void
}

const getStatusVariant = (status: SessionStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'running':
      return 'default'
    case 'building':
    case 'creating':
      return 'secondary'
    case 'error':
      return 'destructive'
    case 'stale':
      return 'outline'
    default:
      return 'outline'
  }
}

const getStatusLabel = (status: SessionStatus): string => {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function SessionManagerCard({
  session,
  onStart,
  onStop,
  onRestart,
  onDelete,
  onViewRequests,
}: SessionManagerCardProps) {
  const isRunning = session.status === 'running'
  const isStopped = session.status === 'stopped'
  const isStarting = session.status === 'building' || session.status === 'creating'
  const canStart = session.status === 'stopped' || session.status === 'creating'
  const navigate = useNavigate()

  const handleOpenOpenCode = async () => {
    if (!session.sessionPath) {
      showToast.error('Workspace path is missing')
      return
    }

    try {
      const client = new OpenCodeClient(
        getSessionOpenCodeEndpoint(session.id),
        session.workspaceContainerPath || session.sessionPath
      )
      const created = await client.createSession({})
      if (!created?.id) {
        showToast.error('Failed to create OpenCode session')
        return
      }
      navigate(`/workspace/${session.id}/sessions/${created.id}`)
    } catch (error) {
      showToast.error('Failed to open OpenCode')
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold truncate">{session.name}</h3>
              <Badge variant={getStatusVariant(session.status)}>
                {getStatusLabel(session.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Template: {session.devcontainerTemplate}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Updated {formatDistanceToNow(new Date(session.lastActiveAt), { addSuffix: true })}
            </p>
          </div>
        </div>
        {session.repos && session.repos.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-xs text-muted-foreground">
              Repos: {session.repos.map((repo) => repo.repoName).join(', ')}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          {canStart && !isRunning && (
            <Button
              size="sm"
              variant="default"
              onClick={() => onStart(session.id)}
            >
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          )}
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStop(session.id)}
            >
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRestart(session.id)}
            disabled={!isRunning && !isStopped}
          >
            <RotateCw className="w-4 h-4 mr-1" />
            Restart
          </Button>
          {isStarting && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              OpenCode
            </Button>
          )}
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleOpenOpenCode}
            >
              <ExternalLink className="w-4 h-4 mr-1" />
              OpenCode
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to={`/workspace/${session.id}`}>
              <ArrowUpRight className="w-4 h-4 mr-1" />
              Details
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewRequests(session.id)}
          >
            Requests
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(session.id)}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
        {!isRunning && (
          <p className="text-xs text-muted-foreground">
            Start workspace to open OpenCode.
          </p>
        )}
      </div>
    </Card>
  )
}
