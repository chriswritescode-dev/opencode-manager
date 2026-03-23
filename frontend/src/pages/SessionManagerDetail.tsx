import { useParams, Navigate, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ExternalLink } from 'lucide-react'
import { useSessionDetail, useStartSession, useStopSession, useRestartSession } from '@/hooks/useSessions'
import { sessionsApi } from '@/api/sessions'
import { showToast } from '@/lib/toast'
import type { SessionStatus } from '@opencode-manager/shared'
import { useQuery } from '@tanstack/react-query'

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

export function SessionManagerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = id || ''
  const { data: session, isLoading } = useSessionDetail(sessionId)
  const startSession = useStartSession()
  const stopSession = useStopSession()
  const restartSession = useRestartSession()
  const { data: worktreeStatuses } = useQuery({
    queryKey: ['worktreeStatuses', sessionId],
    queryFn: () => sessionsApi.getWorktreeStatuses(sessionId),
    enabled: !!sessionId,
  })

  if (!sessionId) {
    return <Navigate to="/workspace" replace />
  }

  const handleOpenOpenCode = async () => {
    if (!session) return
    try {
      const created = await sessionsApi.getOrCreateOpenCodeSession(session.id)
      if (!created || typeof created !== 'object' || !('id' in created)) {
        showToast.error('Failed to create OpenCode session')
        return
      }
      navigate(`/workspace/${session.id}/sessions/${created.id as string}`)
    } catch (error) {
      showToast.error('Failed to open OpenCode')
    }
  }

  const handleOpenCodeServer = () => {
    if (!session) return
    window.open(`http://${session.name}-code.localhost`, '_blank')
  }

  if (isLoading) {
    return (
      <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
        <Header>
          <Header.BackButton to="/workspace" />
          <Header.Title>Workspace Details</Header.Title>
        </Header>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
        <Header>
          <Header.BackButton to="/workspace" />
          <Header.Title>Workspace Details</Header.Title>
        </Header>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Workspace not found
        </div>
      </div>
    )
  }

  const isRunning = session.status === 'running'
  const isStopped = session.status === 'stopped'
  const isStarting = session.status === 'building' || session.status === 'creating'

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <Header.BackButton to="/workspace" />
        <Header.Title>Workspace Details</Header.Title>
        <Header.Actions>
          {!isRunning && (
            <Button size="sm" variant="default" onClick={() => startSession.mutate(session.id)} disabled={isStarting}>
              Start
            </Button>
          )}
          {isRunning && (
            <Button size="sm" variant="outline" onClick={() => stopSession.mutate(session.id)}>
              Stop
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => restartSession.mutate(session.id)} disabled={isStarting}>
            Restart
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenOpenCode} disabled={session.status !== 'running'}>
            <ExternalLink className="w-4 h-4 mr-1" />
            OpenCode
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenCodeServer} disabled={session.status !== 'running'}>
            <ExternalLink className="w-4 h-4 mr-1" />
            Code Server
          </Button>
          <Header.Settings />
        </Header.Actions>
      </Header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="container mx-auto max-w-4xl space-y-4">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-semibold truncate">{session.name}</h2>
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
          </Card>

          {session.repos && session.repos.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Repositories</p>
              <div className="flex flex-col gap-2">
                {session.repos.map((repo, idx) => {
                  const status = worktreeStatuses?.[repo.repoId]
                  const changeCount = status?.files?.length ?? 0
                  const statusLabel = status
                    ? status.hasChanges
                      ? `${changeCount} changes`
                      : 'Clean'
                    : 'Status unavailable'
                  const branchLabel = status?.branch || repo.branch

                  return (
                    <div key={`${repo.repoName}-${idx}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-xs">
                        {repo.repoName}
                        {branchLabel && ` (${branchLabel})`}
                      </Badge>
                      <Badge
                        variant={status?.hasChanges ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {statusLabel}
                      </Badge>
                      {status && (status.ahead > 0 || status.behind > 0) && (
                        <span className="text-muted-foreground">
                          {status.ahead > 0 && `↑${status.ahead}`}
                          {status.ahead > 0 && status.behind > 0 ? ' ' : ''}
                          {status.behind > 0 && `↓${status.behind}`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {session.containers && (
            <Card className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Containers</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {session.containers.opencode && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">OpenCode:</span>
                    <Badge variant={session.containers.opencode.state === 'running' ? 'default' : 'outline'} className="text-xs">
                      {session.containers.opencode.state}
                    </Badge>
                  </div>
                )}
                {session.containers.codeServer && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Code Server:</span>
                    <Badge variant={session.containers.codeServer.state === 'running' ? 'default' : 'outline'} className="text-xs">
                      {session.containers.codeServer.state}
                    </Badge>
                  </div>
                )}
                {session.containers.dind && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">DinD:</span>
                    <Badge variant={session.containers.dind.state === 'running' ? 'default' : 'outline'} className="text-xs">
                      {session.containers.dind.state}
                    </Badge>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
