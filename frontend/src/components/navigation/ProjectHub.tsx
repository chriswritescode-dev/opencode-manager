import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Loader2, Layers, Plus, Server } from 'lucide-react'
import { ASSISTANT_REPO_ID, getRepoDirectoryNameError, isWorktreeSibling } from '@opencode-manager/shared/utils'
import type { MultiRunTarget } from '@opencode-manager/shared/schemas'
import { repoQueryOptions } from '@/lib/repoQuery'
import { getServerSessionPath, getSessionPath } from '@/lib/navigation'
import { notifyWorktreeSetup } from '@/lib/worktreeSetup'
import { encodeProjectTarget, type ProjectTarget } from '@/lib/projectTarget'
import { SessionList, type SessionListRenderArgs } from '@/components/session/SessionList'
import { WorktreeTabs, type WorktreeTabValue } from '@/components/repo/WorktreeTabs'
import { WorktreeSessionGroups } from '@/components/repo/WorktreeSessionGroups'
import { ProjectHubOverflowMenu } from '@/components/navigation/ProjectHubOverflowMenu'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'
import { ServersUnavailableCard } from '@/components/servers/ServersUnavailableCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useRepoActivity } from '@/hooks/useRepoActivity'
import { useCreateRepoWorkspace, useDeleteRepoWorkspaces, useRepoSiblings } from '@/hooks/useRepoSiblings'
import { useMultiRuns } from '@/hooks/useMultiRuns'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSSE } from '@/hooks/useSSE'
import { useSideMenu } from '@/hooks/useSideMenu'
import { openDialogParams } from '@/hooks/useDialogParam'
import { useUrlParams } from '@/hooks/useUrlParams'

/**
 * Renders the project hub for a Manager repo or a directory on a linked OpenCode server.
 */
export function ProjectHub({ target }: { target: ProjectTarget }) {
  if (target.kind === 'repo') return <RepoProjectHub repoId={target.repoId} />
  return (
    <OpenCodeServerProvider serverId={target.serverId}>
      <ServerProjectHub serverId={target.serverId} directory={target.directory} />
    </OpenCodeServerProvider>
  )
}

function ServerProjectHub({ serverId, directory }: { serverId: string; directory?: string }) {
  const { navigateFromMenu } = useSideMenu()
  const {
    servers,
    showsInitialLoading: serversLoading,
    isPaused: serversPaused,
    refetch: refetchServers,
  } = useOpenCodeServers()
  const { openTab } = useSettingsDialog()

  const server = servers.find((candidate) => candidate.id === serverId)
  const serversUnavailable = serversPaused && servers.length === 0
  const isDisabled = server !== undefined && !server.enabled
  const isReady = server?.enabled === true && Boolean(directory)
  const createSessionMutation = useCreateSession(directory)

  useSSE(directory)

  const serverTarget = useMemo<ProjectTarget | null>(
    () => (directory ? { kind: 'server', serverId, directory } : null),
    [serverId, directory],
  )

  const openSettings = () => openTab('servers')

  const handleCreateSession = () => {
    createSessionMutation.mutate({}, {
      onSuccess: (session) => navigateFromMenu(getServerSessionPath(serverId, session.id)),
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <Button
          onClick={handleCreateSession}
          disabled={!isReady || createSessionMutation.isPending}
          aria-label="New Session"
          size="sm"
          className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>
        {serverTarget && (
          <ProjectHubOverflowMenu target={serverTarget} directory={directory} />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {serversLoading && directory ? (
          <div
            role="status"
            aria-label="Loading project"
            className="flex flex-1 items-center justify-center"
          >
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : serversUnavailable ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-4">
            <ServersUnavailableCard onRetry={refetchServers} />
          </div>
        ) : !serversLoading && !server ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-4">
            <LinkedServerStateCard
              icon={Server}
              title="Server not found"
              description="This linked server is no longer configured."
              actionLabel="Open server settings"
              onAction={openSettings}
            />
          </div>
        ) : isDisabled ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-4">
            <LinkedServerStateCard
              icon={Server}
              title="This server is disabled"
              description="Enable it in Settings → Servers to browse its projects and sessions."
              actionLabel="Open server settings"
              onAction={openSettings}
            />
          </div>
        ) : !directory ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-4">
            <LinkedServerStateCard
              icon={FolderGit2}
              title="No project selected"
              description="This project link is missing its directory on the server."
              actionLabel="Back to projects"
              onAction={() => navigateFromMenu('/')}
            />
          </div>
        ) : isReady ? (
          <SessionList
            key={directory}
            directory={directory}
            createDirectory={directory}
            onSelectSession={(sessionId) => navigateFromMenu(getServerSessionPath(serverId, sessionId))}
          />
        ) : null}
      </div>
    </div>
  )
}

function RepoProjectHub({ repoId }: { repoId: number }) {
  const location = useLocation()
  const { navigateFromMenu } = useSideMenu()
  const { updateParams } = useUrlParams()
  const isAssistant = repoId === ASSISTANT_REPO_ID
  const [activeTab, setActiveTab] = useState<WorktreeTabValue>(() => {
    if (repoId === ASSISTANT_REPO_ID) return 'repo'
    return new URLSearchParams(location.search).get('repoTab') === 'workspaces' ? 'workspaces' : 'repo'
  })
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [expandedScheduleDirectories, setExpandedScheduleDirectories] = useState<string[]>([])

  const { data: repo, isLoading: repoLoading } = useQuery(repoQueryOptions(repoId))

  useRepoActivity(repoId, Boolean(repo) && !isAssistant)

  const { data: siblings } = useRepoSiblings(repoId)
  const deleteWorkspaces = useDeleteRepoWorkspaces(repoId)
  const createWorkspace = useCreateRepoWorkspace(repoId)

  const workspaceSiblings = useMemo(
    () => (siblings ?? []).filter((sibling) => isWorktreeSibling(sibling) && !!sibling.fullPath),
    [siblings],
  )

  const scheduleDirectorySet = useMemo(
    () => new Set(
      workspaceSiblings
        .filter((sibling) => sibling.worktreeSource === 'schedule')
        .map((sibling) => sibling.fullPath),
    ),
    [workspaceSiblings],
  )

  const nonScheduleWorkspaceDirectories = useMemo(
    () => workspaceSiblings
      .filter((sibling) => sibling.worktreeSource !== 'schedule')
      .map((sibling) => sibling.fullPath)
      .filter(Boolean),
    [workspaceSiblings],
  )

  const activeScheduleDirectories = useMemo(
    () => expandedScheduleDirectories.filter((directory) => scheduleDirectorySet.has(directory)),
    [expandedScheduleDirectories, scheduleDirectorySet],
  )

  const handleExpandedScheduleDirectoriesChange = useCallback((directories: string[]) => {
    setExpandedScheduleDirectories((current) =>
      current.length === directories.length && current.every((directory, index) => directory === directories[index])
        ? current
        : directories,
    )
  }, [])

  const baseDirectory = repo?.fullPath
  const subscriptionDirectories = useMemo(() => {
    const set = new Set<string>()
    if (baseDirectory) set.add(baseDirectory)
    nonScheduleWorkspaceDirectories.forEach((dir) => set.add(dir))
    activeScheduleDirectories.forEach((dir) => set.add(dir))
    return Array.from(set)
  }, [baseDirectory, nonScheduleWorkspaceDirectories, activeScheduleDirectories])

  const showWorktrees = !isAssistant && activeTab === 'workspaces'
  const multiRunTarget = useMemo<MultiRunTarget>(() => ({ kind: 'repo', repoId }), [repoId])
  const { data: multiRuns } = useMultiRuns(multiRunTarget, showWorktrees && !isAssistant)
  const sessionListDirectories = useMemo(() => {
    if (!showWorktrees) return baseDirectory ? [baseDirectory] : []
    return Array.from(new Set([...nonScheduleWorkspaceDirectories, ...activeScheduleDirectories]))
  }, [showWorktrees, baseDirectory, nonScheduleWorkspaceDirectories, activeScheduleDirectories])

  useEffect(() => {
    if (!showWorktrees) setExpandedScheduleDirectories([])
  }, [showWorktrees])

  useSSE(subscriptionDirectories)

  const createSessionMutation = useCreateSession(baseDirectory)

  const openSession = useCallback((sessionId: string, inWorktree: boolean) => {
    navigateFromMenu(getSessionPath(repoId, sessionId, inWorktree ? { repoTab: 'workspaces' } : undefined))
  }, [navigateFromMenu, repoId])

  const handleCreateSession = (directory = baseDirectory) => {
    if (!directory) return
    createSessionMutation.mutate({ directory }, {
      onSuccess: (session) => openSession(session.id, directory !== baseDirectory),
    })
  }

  const openProjectTerminal = useCallback((terminalId: string | null, extraParams?: Record<string, string>) => {
    updateParams((params) => {
      openDialogParams(params, 'terminal', {
        ...(terminalId ? { terminal: terminalId } : {}),
        ...extraParams,
      })
      params.set('toolProject', encodeProjectTarget({ kind: 'repo', repoId }))
      params.delete('menu')
      params.delete('menuProject')
    })
  }, [repoId, updateParams])

  const handleCreateWorkspace = (name: string) => {
    createWorkspace.mutate(name ? { name } : {}, {
      onSuccess: (workspace) => {
        setCreateWorkspaceOpen(false)
        notifyWorktreeSetup(workspace.worktreeSetup)
        if (workspace.worktreeSetup?.status === 'started') {
          const terminalId = workspace.worktreeSetup.terminal.id
          openProjectTerminal(terminalId, {
            repoTab: 'workspaces',
            ...(workspace.directory ? { terminalDirectory: workspace.directory } : {}),
          })
          return
        }
        setActiveTab('workspaces')
      },
    })
  }

  const renderWorktreeGroups = ({ sessions, searchQuery, renderSessionCard }: SessionListRenderArgs) => (
    <WorktreeSessionGroups
      repoId={repoId}
      worktrees={workspaceSiblings}
      sessions={sessions}
      multiRuns={multiRuns}
      searchQuery={searchQuery}
      renderSessionCard={renderSessionCard}
      onExpandedScheduleDirectoriesChange={handleExpandedScheduleDirectoriesChange}
      onNewSession={handleCreateSession}
      onOpenTerminal={(directory) => openProjectTerminal(null, { repoTab: 'workspaces', terminalDirectory: directory })}
      onCreateWorktree={() => setCreateWorkspaceOpen(true)}
      onDelete={(directories) => deleteWorkspaces.mutate(directories)}
      isDeleting={deleteWorkspaces.isPending}
    />
  )

  if (repoLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Repository not found</p>
      </div>
    )
  }

  if (repo.cloneStatus !== 'ready') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          {repo.cloneStatus === 'cloning' ? 'Cloning repository...' : 'Repository not ready'}
        </p>
      </div>
    )
  }

  const currentBranch = repo.currentBranch || repo.branch || 'main'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <Button
          onClick={() => handleCreateSession()}
          disabled={!baseDirectory || createSessionMutation.isPending}
          aria-label="New Session"
          size="sm"
          className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>
        <ProjectHubOverflowMenu
          target={{ kind: 'repo', repoId }}
          directory={baseDirectory}
          includeMultiRun={!isAssistant}
          onCreateWorktree={isAssistant ? undefined : () => setCreateWorkspaceOpen(true)}
        />
      </div>

      {!isAssistant && (
        <WorktreeTabs
          workspaces={workspaceSiblings}
          value={activeTab}
          onValueChange={setActiveTab}
          baseLabel={currentBranch}
          onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {(showWorktrees || sessionListDirectories.length > 0) && (
          <SessionList
            key={showWorktrees ? 'worktrees' : 'repo'}
            directories={sessionListDirectories}
            createDirectory={baseDirectory}
            onSelectSession={(sessionId) => openSession(sessionId, showWorktrees)}
            renderSessions={showWorktrees ? renderWorktreeGroups : undefined}
          />
        )}
      </div>

      {!isAssistant && (
        <CreateWorkspaceDialog
          open={createWorkspaceOpen}
          onOpenChange={setCreateWorkspaceOpen}
          onCreate={handleCreateWorkspace}
          isCreating={createWorkspace.isPending}
        />
      )}
    </div>
  )
}

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => void
  isCreating: boolean
}

function CreateWorkspaceDialog({ open, onOpenChange, onCreate, isCreating }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("")
  const trimmedName = name.trim()
  const nameError = trimmedName ? getRepoDirectoryNameError(trimmedName) : null

  const handleOpenChange = (next: boolean) => {
    if (!next) setName("")
    onOpenChange(next)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (nameError || isCreating) return
    onCreate(trimmedName)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Create Worktree
            </DialogTitle>
            <DialogDescription>
              OpenCode creates a git worktree of this repository from the current commit.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="worktree-name">Name</Label>
            <Input
              id="worktree-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Generated if empty"
              autoComplete="off"
              autoFocus
              disabled={isCreating}
              aria-invalid={nameError ? true : undefined}
              aria-describedby="worktree-name-hint"
            />
            <p id="worktree-name-hint" className={`text-xs ${nameError ? "text-destructive" : "text-muted-foreground"}`}>
              {nameError ?? "Used as the folder name and its label under Worktrees. If the folder already exists, a number is added."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || Boolean(nameError)} className="bg-primary hover:bg-primary-hover text-primary-foreground">
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Worktree'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
