import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder, FolderGit2, FolderPlus, GitBranch, Search, Server } from 'lucide-react'
import { remoteProjectName, type OpenCodeProject } from '@/api/opencode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useRemoteProjectsByActivity } from '@/hooks/useRemoteProjects'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useProjectActivityState } from '@/hooks/useActiveWork'
import { getServerProjectPath } from '@/lib/navigation'
import { formatShortRelativeTime } from '@/lib/utils'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'
import { OpenDirectoryDialog } from '@/components/servers/OpenDirectoryDialog'
import { RemoteProjectRowActions } from '@/components/servers/RemoteProjectRowActions'
import { RepoCardShell } from '@/components/repo/RepoCardShell'
import { RepoCardSkeleton } from '@/components/repo/RepoCardSkeleton'
import { RepoSearchInput } from '@/components/repo/RepoSearchInput'

interface RemoteProjectCardProps {
  project: OpenCodeProject
  serverId: string
  activityAt: number
}

function RemoteProjectCard({ project, serverId, activityAt }: RemoteProjectCardProps) {
  const navigate = useNavigate()
  const activityState = useProjectActivityState(serverId, project.canonical)

  return (
    <RepoCardShell
      title={remoteProjectName(project)}
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
      activityLabel={activityAt > 0 ? formatShortRelativeTime(new Date(activityAt)) : undefined}
      isInteractive
      onClick={() => navigate(getServerProjectPath(serverId, project.canonical))}
    />
  )
}

function OpenDirectoryTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open directory"
      title="Open directory"
      className="h-9 w-9 shrink-0"
      onClick={onClick}
    >
      <FolderPlus className="h-4 w-4" />
    </Button>
  )
}

function RemoteProjectListLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-2 md:px-0">
        <div className="h-10 bg-muted/50 animate-pulse rounded w-full" />
      </div>
      <div className="mx-2 md:mx-0 flex-1 min-h-0">
        <div className="h-full overflow-y-auto pt-4 pb-2 md:pb-4">
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
  const { servers, isLoading: serversLoading } = useOpenCodeServers()
  const { openTab } = useSettingsDialog()
  const [openDirectoryOpen, setOpenDirectoryOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const server = servers.find((candidate) => candidate.id === serverId)
  const isDisabled = server !== undefined && !server.enabled

  const { projects, activityById, isLoading, isError, hasData, error, refetch } = useRemoteProjectsByActivity(serverId)
  const showsProjectError = isError && !hasData

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return projects

    return projects.filter((project) =>
      remoteProjectName(project).toLowerCase().includes(query) ||
      project.canonical.toLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  const openSettings = () => openTab('servers')

  return (
    <div className="flex h-full flex-col px-0 md:px-4 md:pt-4">
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

      {server && !isDisabled && showsProjectError ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <Server className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Could not load projects</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : 'The server did not respond.'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : null}

      {server && !isDisabled && !showsProjectError ? (
        isLoading ? (
          <RemoteProjectListLoading />
        ) : projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <FolderGit2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="font-medium">No projects on this server yet</p>
            <p className="text-sm text-muted-foreground">
              Start a session in a directory to create one.
            </p>
            <div className="mt-4">
              <OpenDirectoryTrigger onClick={() => setOpenDirectoryOpen(true)} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 md:px-0">
              <RepoSearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                placeholder="Search projects..."
                name="remote-project-search"
              />
              <OpenDirectoryTrigger onClick={() => setOpenDirectoryOpen(true)} />
            </div>
            <div className="mx-2 flex min-h-0 flex-1 md:mx-0">
              <div className="h-full w-full overflow-y-auto pt-4 md:pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
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
                        activityAt={activityById.get(project.id) ?? 0}
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
        <OpenDirectoryDialog
          serverId={serverId}
          open={openDirectoryOpen}
          onOpenChange={setOpenDirectoryOpen}
        />
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
