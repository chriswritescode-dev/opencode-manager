import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FolderGit2, GitBranch, Loader2, Plus, Server } from 'lucide-react'
import { remoteProjectName } from '@/api/opencode'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useRemoteProjects } from '@/hooks/useRemoteProjects'
import { useVcsInfo } from '@/hooks/useVcsInfo'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSSE } from '@/hooks/useSSE'
import { useToolPanelLayout } from '@/hooks/useToolPanelLayout'
import { useToolPanel } from '@/hooks/useToolPanel'
import { useDialogParam } from '@/hooks/useDialogParam'
import { useTerminalDialogParam, useTerminalDirectoryParam } from '@/hooks/useOpenTerminal'
import { getServerSessionPath } from '@/lib/navigation'
import { getDirectoryName } from '@/lib/utils'
import { Header } from '@/components/ui/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SessionList } from '@/components/session/SessionList'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'
import { ServersUnavailableCard } from '@/components/servers/ServersUnavailableCard'
import { RemoteSchedulesButton } from '@/components/schedules/RemoteSchedulesButton'
import { RemoteMultiRunButton } from '@/components/repo/RemoteMultiRunButton'
import { RepoMcpDialog } from '@/components/repo/RepoMcpDialog'
import { RepoSkillsDialog } from '@/components/repo/RepoSkillsDialog'
import { RemoteSourceControlPanel } from '@/components/source-control/RemoteSourceControlContent'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { ToolSidePanel } from '@/components/navigation/ToolSidePanel'

function RemoteProjectContent({ serverId, directory }: { serverId: string; directory?: string }) {
  const navigate = useNavigate()
  const {
    servers,
    showsInitialLoading: serversLoading,
    isPaused: serversPaused,
    refetch: refetchServers,
  } = useOpenCodeServers()
  const { openTab } = useSettingsDialog()
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp')
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills')
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl')
  const [terminalOpen, setTerminalOpen] = useTerminalDialogParam()
  const terminalDirectory = useTerminalDirectoryParam()
  const { docked, showRail } = useToolPanelLayout()
  const toolPanel = useToolPanel(showRail)

  const server = servers.find((candidate) => candidate.id === serverId)
  const serversUnavailable = serversPaused && servers.length === 0
  const isDisabled = server !== undefined && !server.enabled
  const isReady = server?.enabled === true && Boolean(directory)
  const createSession = useCreateSession(directory)

  const { projects } = useRemoteProjects(serverId)

  const vcsQuery = useVcsInfo(directory, serverId, { enabled: isReady })

  useSSE(directory)

  const project = projects.find((entry) => entry.canonical === directory)
  const branch = vcsQuery.data?.branch.current ?? vcsQuery.data?.branch.default
  const title = project
    ? remoteProjectName(project)
    : directory
      ? getDirectoryName(directory)
      : 'Project'

  const openSettings = () => openTab('servers')

  const handleCreateSession = () => {
    createSession.mutate({}, {
      onSuccess: (session) => navigate(getServerSessionPath(serverId, session.id)),
    })
  }

  return (
    <div className="flex h-full max-h-full min-w-0">
      <div className="flex h-full max-h-full min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-background via-background to-background pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
        <Header>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Header.BackButton to="/" />
            <Header.Title>{title}</Header.Title>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              <Server className="mr-1 h-3 w-3" />
              {server?.name ?? 'Linked server'}
            </Badge>
            {branch ? (
              <Badge variant="secondary" className="hidden shrink-0 md:inline-flex">
                <GitBranch className="mr-1 h-3 w-3" />
                {branch}
              </Badge>
            ) : null}
          </div>
          <Header.Actions className="shrink-0 gap-1 pl-2 sm:gap-2">
            {directory ? (
              <>
                <RemoteSchedulesButton serverId={serverId} directory={directory} />
                <RemoteMultiRunButton serverId={serverId} directory={directory} />
                <Button
                  onClick={handleCreateSession}
                  disabled={createSession.isPending}
                  size="sm"
                  className="hidden bg-primary text-primary-foreground transition-all duration-200 hover:scale-105 hover:bg-primary-hover sm:inline-flex"
                >
                  {createSession.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  <span>New Session</span>
                </Button>
                <Button
                  onClick={handleCreateSession}
                  disabled={createSession.isPending}
                  aria-label="New Session"
                  size="sm"
                  className="h-10 w-10 bg-primary p-0 text-primary-foreground transition-all duration-200 hover:scale-105 hover:bg-primary-hover sm:hidden"
                >
                  {createSession.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Plus className="h-5 w-5" />
                  )}
                </Button>
              </>
            ) : null}
          </Header.Actions>
        </Header>

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
                onAction={() => navigate('/')}
              />
            </div>
          ) : isReady ? (
            <SessionList
              key={directory}
              directory={directory}
              createDirectory={directory}
              onSelectSession={(sessionId) => navigate(getServerSessionPath(serverId, sessionId))}
            />
          ) : null}
        </div>
      </div>

      {showRail && directory ? (
        <ToolSidePanel
          panel={toolPanel}
          filesBasePath={directory}
          directory={directory}
          terminalDirectory={terminalDirectory ?? directory}
          terminalTarget={{ kind: 'server', serverId }}
          repoDirectory={directory}
        />
      ) : null}

      {directory ? (
        <>
          <RepoMcpDialog
            open={!docked && mcpDialogOpen}
            onOpenChange={setMcpDialogOpen}
            directory={directory}
          />
          <RepoSkillsDialog
            open={!docked && skillsDialogOpen}
            onOpenChange={setSkillsDialogOpen}
            directory={directory}
          />
          <RemoteSourceControlPanel
            serverId={serverId}
            directory={directory}
            isOpen={!docked && sourceControlOpen}
            onClose={() => setSourceControlOpen(false)}
          />
          <TerminalPanel
            target={{ kind: 'server', serverId }}
            directory={terminalDirectory ?? directory}
            isOpen={!docked && terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        </>
      ) : null}
    </div>
  )
}

export function RemoteProject() {
  const { serverId } = useParams<{ serverId: string }>()
  const [searchParams] = useSearchParams()
  const directory = searchParams.get('directory') ?? undefined

  if (!serverId) {
    return null
  }

  return <RemoteProjectContent serverId={serverId} directory={directory} />
}
