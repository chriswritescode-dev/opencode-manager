import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, GitBranch, Loader2, Plus, Server } from 'lucide-react'
import { getVcsInfo, listProjects } from '@/api/opencode'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSSE } from '@/hooks/useSSE'
import { useMobile } from '@/hooks/useMobile'
import { useToolPanel } from '@/hooks/useToolPanel'
import { useDialogParam } from '@/hooks/useDialogParam'
import { useTerminalDialogParam, useTerminalDirectoryParam } from '@/hooks/useOpenTerminal'
import { serverScopedKey } from '@/lib/serverScope'
import { getServerPath, getServerSessionPath } from '@/lib/navigation'
import { getDirectoryName } from '@/lib/utils'
import { Header } from '@/components/ui/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SessionList } from '@/components/session/SessionList'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'
import { RemoteSchedulesButton } from '@/components/schedules/RemoteSchedulesButton'
import { RemoteMultiRunButton } from '@/components/repo/RemoteMultiRunButton'
import { RepoMcpDialog } from '@/components/repo/RepoMcpDialog'
import { RepoSkillsDialog } from '@/components/repo/RepoSkillsDialog'
import { RemoteSourceControlPanel } from '@/components/source-control/RemoteSourceControlContent'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { ToolSidePanel } from '@/components/navigation/ToolSidePanel'

function RemoteProjectContent({ serverId, directory }: { serverId: string; directory?: string }) {
  const navigate = useNavigate()
  const { servers, isLoading: serversLoading } = useOpenCodeServers()
  const { setActiveTab } = useSettingsDialog()
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp')
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills')
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl')
  const [terminalOpen, setTerminalOpen] = useTerminalDialogParam()
  const terminalDirectory = useTerminalDirectoryParam()
  const docked = !useMobile()
  const toolPanel = useToolPanel(docked)

  const server = servers.find((candidate) => candidate.id === serverId)
  const isDisabled = server !== undefined && !server.enabled
  const isReady = server?.enabled === true && Boolean(directory)
  const createSession = useCreateSession(directory)

  const projectsQuery = useQuery({
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    enabled: server?.enabled === true,
    retry: false,
  })

  const vcsQuery = useQuery({
    queryKey: [...serverScopedKey(['opencode', 'vcs', directory ?? ''], serverId), 'info'],
    queryFn: () => getVcsInfo(directory ?? '', serverId),
    enabled: isReady,
    retry: false,
  })

  useSSE(directory)

  const project = (projectsQuery.data ?? []).find((entry) => entry.canonical === directory)
  const branch = vcsQuery.data?.branch.current ?? vcsQuery.data?.branch.default
  const title = project?.name?.trim() || (directory ? getDirectoryName(directory) : 'Project')

  const openSettings = () => setActiveTab('servers')

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
            <Header.BackButton to={getServerPath(serverId)} />
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
          {!serversLoading && !server ? (
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
                actionLabel="Back to server"
                onAction={() => navigate(getServerPath(serverId))}
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

      {docked && directory ? (
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
