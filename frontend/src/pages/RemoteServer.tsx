import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  Plus,
  Server,
  Settings,
} from 'lucide-react'
import type { OpenCodeServerStatus } from '@opencode-manager/shared/schemas'
import { listProjects, type OpenCodeProject } from '@/api/opencode'
import { useCreateSession, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSSE } from '@/hooks/useSSE'
import { serverScopedKey } from '@/lib/serverScope'
import { getServerSessionPath } from '@/lib/navigation'
import { getDirectoryName } from '@/lib/utils'
import { Header } from '@/components/ui/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'

function ConnectionStatus({ status, isLoading }: { status?: OpenCodeServerStatus; isLoading: boolean }) {
  if (isLoading) {
    return <span className="text-xs text-muted-foreground">Checking connection...</span>
  }

  if (!status) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        Unknown
      </span>
    )
  }

  if (!status.connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" title={status.error ?? undefined}>
        <span className="h-2 w-2 rounded-full bg-destructive" />
        Unreachable
        {status.error ? <span className="text-muted-foreground">· {status.error}</span> : null}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-success">
      <span className="h-2 w-2 rounded-full bg-success" />
      Connected
      {status.version ? <span className="text-muted-foreground">· v{status.version}</span> : null}
    </span>
  )
}

function ProjectSessions({ serverId, directory }: { serverId: string; directory: string }) {
  useSSE(directory)
  const { data: sessions, isLoading } = useSessionsAcrossDirectories([directory])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sessions...
      </div>
    )
  }

  if (sessions.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">No sessions in this project yet.</p>
  }

  return (
    <ul className="flex flex-col gap-1 px-2 pb-2">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            to={getServerSessionPath(serverId, session.id)}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex items-center gap-2">
              <SessionStatusIndicator sessionID={session.id} size="sm" />
              <span className="truncate font-medium">{session.title || 'Untitled Session'}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(session.time.updated), { addSuffix: true })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ProjectRow({ project, serverId }: { project: OpenCodeProject; serverId: string }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const createSession = useCreateSession(project.canonical)
  const name = project.name?.trim() || getDirectoryName(project.canonical)

  const handleNewSession = async () => {
    try {
      const session = await createSession.mutateAsync({ agent: undefined })
      navigate(getServerSessionPath(serverId, session.id))
    } catch {
      return
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent/50"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{project.canonical}</span>
          </span>
          {project.vcs ? (
            <Badge variant="outline" className="ml-1 hidden shrink-0 sm:inline-flex">
              {project.vcs}
            </Badge>
          ) : null}
        </button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleNewSession}
          disabled={createSession.isPending}
          className="shrink-0"
        >
          {createSession.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
          New session
        </Button>
      </div>
      {expanded ? <ProjectSessions serverId={serverId} directory={project.canonical} /> : null}
    </Card>
  )
}

function RemoteServerContent({ serverId }: { serverId: string }) {
  const navigate = useNavigate()
  const { servers, isLoading: serversLoading } = useOpenCodeServers()
  const { statusById, isLoading: statusLoading } = useOpenCodeServerStatuses()
  const { setActiveTab } = useSettingsDialog()
  const createSession = useCreateSession()
  const [openDirectory, setOpenDirectory] = useState('')

  const server = servers.find((candidate) => candidate.id === serverId)
  const status = statusById[serverId]
  const isDisabled = server !== undefined && !server.enabled

  const projectsQuery = useQuery({
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    enabled: server?.enabled === true,
    retry: false,
  })

  const openSettings = () => setActiveTab('servers')

  const handleOpenDirectory = async (event: FormEvent) => {
    event.preventDefault()
    const directory = openDirectory.trim()
    if (!directory) return
    try {
      const session = await createSession.mutateAsync({ directory })
      navigate(getServerSessionPath(serverId, session.id))
    } catch {
      return
    }
  }

  return (
    <div className="flex h-full max-h-full min-w-0 flex-col overflow-hidden bg-gradient-to-br from-background via-background to-background">
      <Header>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Header.BackButton to="/" />
          <Header.Title>{server?.name ?? 'Linked server'}</Header.Title>
          <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground sm:block">
            {server?.baseUrl}
          </span>
        </div>
        <Header.Actions>
          <ConnectionStatus status={status} isLoading={statusLoading && !status} />
          <Button variant="outline" size="sm" onClick={openSettings}>
            <Settings className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Manage servers</span>
            <span className="sr-only sm:hidden">Manage servers</span>
          </Button>
        </Header.Actions>
      </Header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-4">
        {!serversLoading && !server ? (
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <Server className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Server not found</p>
              <p className="text-sm text-muted-foreground">
                This linked server is no longer configured.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openSettings}>
              Open server settings
            </Button>
          </Card>
        ) : null}

        {isDisabled ? (
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <Server className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">This server is disabled</p>
              <p className="text-sm text-muted-foreground">
                Enable it in Settings → Servers to browse its projects and sessions.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openSettings}>
              Open server settings
            </Button>
          </Card>
        ) : null}

        {server && !isDisabled && projectsQuery.isError ? (
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <Server className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Could not load projects</p>
              <p className="text-sm text-muted-foreground">
                {projectsQuery.error instanceof Error
                  ? projectsQuery.error.message
                  : 'The server did not respond.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void projectsQuery.refetch()}>
              Retry
            </Button>
          </Card>
        ) : null}

        {server && !isDisabled && !projectsQuery.isError ? (
          <section aria-label="Projects" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projects</h2>
              {projectsQuery.isFetching ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Refreshing
                </span>
              ) : null}
            </div>

            {projectsQuery.isLoading ? (
              <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading projects...
              </Card>
            ) : (projectsQuery.data ?? []).length === 0 ? (
              <Card className="flex flex-col items-center gap-2 p-6 text-center">
                <FolderGit2 className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No projects on this server yet</p>
                <p className="text-sm text-muted-foreground">
                  Start a session in a directory below to create one.
                </p>
              </Card>
            ) : (
              (projectsQuery.data ?? []).map((project) => (
                <ProjectRow key={project.id} project={project} serverId={serverId} />
              ))
            )}
          </section>
        ) : null}

        {server && !isDisabled ? (
          <section aria-label="Open directory" className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Open directory</h2>
            <form onSubmit={handleOpenDirectory} className="flex items-center gap-2">
              <Input
                value={openDirectory}
                onChange={(event) => setOpenDirectory(event.target.value)}
                placeholder="/absolute/path/on/the/server"
                aria-label="Directory path"
                autoComplete="off"
                name="remote-directory"
                className="font-mono text-sm"
              />
              <Button type="submit" disabled={!openDirectory.trim() || createSession.isPending} className="shrink-0">
                {createSession.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                Start session
              </Button>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export function RemoteServer() {
  const { serverId } = useParams<{ serverId: string }>()

  if (!serverId) {
    return null
  }

  return <RemoteServerContent serverId={serverId} />
}
