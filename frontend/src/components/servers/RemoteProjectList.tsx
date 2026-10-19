import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderGit2, GitBranch, Loader2, Plus, Search, Server } from 'lucide-react'
import { listProjects, type OpenCodeProject } from '@/api/opencode'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useProjectActivityState } from '@/hooks/useActiveWork'
import { serverScopedKey } from '@/lib/serverScope'
import { getServerProjectPath, getServerSessionPath } from '@/lib/navigation'
import { formatShortRelativeTime, getDirectoryName } from '@/lib/utils'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'
import { RemoteProjectRowActions } from '@/components/servers/RemoteProjectRowActions'
import { RepoCardShell } from '@/components/repo/RepoCardShell'
import { RepoCardSkeleton } from '@/components/repo/RepoCardSkeleton'
import { RepoSearchInput } from '@/components/repo/RepoSearchInput'

function projectName(project: OpenCodeProject): string {
  return project.name?.trim() || getDirectoryName(project.canonical)
}

function RemoteProjectCard({ project, serverId }: { project: OpenCodeProject; serverId: string }) {
  const navigate = useNavigate()
  const activityState = useProjectActivityState(serverId, project.canonical)
  const updatedAt = project.time.updated

  return (
    <RepoCardShell
      title={projectName(project)}
      statusDotClassName="bg-success"
      activity={<ActivityStateIndicator state={activityState} />}
      actions={<RemoteProjectRowActions serverId={serverId} directory={project.canonical} />}
      meta={
        <span className="flex items-center gap-1 min-w-0">
          {project.vcs ? (
            <GitBranch className="w-3.5 h-3.5 shrink-0" aria-label={project.vcs} />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{project.canonical}</span>
        </span>
      }
      activityLabel={updatedAt > 0 ? formatShortRelativeTime(new Date(updatedAt)) : undefined}
      isInteractive
      onClick={() => navigate(getServerProjectPath(serverId, project.canonical))}
    />
  )
}

function RemoteProjectListLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-2 md:px-0">
        <div className="h-10 bg-muted/50 animate-pulse rounded w-full" />
      </div>
      <div className="mx-2 md:mx-0 flex-1 min-h-0">
        <div className="h-full overflow-y-auto pt-4 pb-2 md:pb-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full">
            {Array.from({ length: 6 }).map((_, index) => (
              <RepoCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RemoteProjectListContent({ serverId }: { serverId: string }) {
  const navigate = useNavigate()
  const { servers, isLoading: serversLoading } = useOpenCodeServers()
  const { openTab } = useSettingsDialog()
  const createSession = useCreateSession()
  const [openDirectory, setOpenDirectory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const server = servers.find((candidate) => candidate.id === serverId)
  const isDisabled = server !== undefined && !server.enabled

  const projectsQuery = useQuery({
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    enabled: server?.enabled === true,
    retry: false,
  })

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return projects

    return projects.filter((project) =>
      projectName(project).toLowerCase().includes(query) ||
      project.canonical.toLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  const openSettings = () => openTab('servers')

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
    <div className="flex h-full flex-col px-0 md:p-4">
      {!serversLoading && !server ? (
        <LinkedServerStateCard
          icon={Server}
          title="Server not found"
          description="This linked server is no longer configured."
          actionLabel="Open server settings"
          onAction={openSettings}
        />
      ) : null}

      {isDisabled ? (
        <LinkedServerStateCard
          icon={Server}
          title="This server is disabled"
          description="Enable it in Settings → Servers to browse its projects and sessions."
          actionLabel="Open server settings"
          onAction={openSettings}
        />
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
        projectsQuery.isLoading ? (
          <RemoteProjectListLoading />
        ) : projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <FolderGit2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="font-medium">No projects on this server yet</p>
            <p className="text-sm text-muted-foreground">
              Start a session in a directory below to create one.
            </p>
          </div>
        ) : (
          <>
            <div className="px-2 md:px-0">
              <RepoSearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                placeholder="Search projects..."
                name="remote-project-search"
              />
            </div>
            <div className="mx-2 flex min-h-0 flex-1 md:mx-0">
              <div className="h-full w-full overflow-y-auto pt-4 md:pb-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
                {filteredProjects.length === 0 ? (
                  <div className="text-center p-12">
                    <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      No projects found matching "{searchQuery}"
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full md:pb-0">
                    {filteredProjects.map((project) => (
                      <RemoteProjectCard
                        key={project.id}
                        project={project}
                        serverId={serverId}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )
      ) : null}

      {server && !isDisabled ? (
        <section aria-label="Open directory" className="mt-4 flex shrink-0 flex-col gap-2 px-2 md:px-0">
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
  )
}

/**
 * The projects of one linked server with their sessions and project actions, scoped to that server
 * so every hook inside it targets the linked server rather than the local one.
 */
export function RemoteProjectList({ serverId }: { serverId: string }) {
  return (
    <OpenCodeServerProvider serverId={serverId}>
      <RemoteProjectListContent serverId={serverId} />
    </OpenCodeServerProvider>
  )
}
