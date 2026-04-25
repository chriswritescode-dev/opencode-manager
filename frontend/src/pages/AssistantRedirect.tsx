import { useCallback, useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRepo, initializeAssistantMode, listRepos } from "@/api/repos"
import { useAssistantSessionLauncher } from "@/hooks/useAssistantSessionLauncher"
import { useCreateSession } from "@/hooks/useOpenCode"
import { useDialogParam } from "@/hooks/useDialogParam"
import { useSSE } from "@/hooks/useSSE"
import { OPENCODE_API_ENDPOINT } from "@/config"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/ui/header"
import { SessionList } from "@/components/session/SessionList"
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet"
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog"
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog"
import { SourceControlPanel } from "@/components/source-control"
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog"
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup"
import { invalidateConfigCaches } from "@/lib/queryInvalidation"
import { SwitchConfigDialog } from "@/components/repo/SwitchConfigDialog"
import { Loader2, Plus } from "lucide-react"

export function AssistantRedirect() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const repoId = Number(id) || 0
  const showSessionList = new URLSearchParams(location.search).get('view') === 'sessions'
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files')
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp')
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills')
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl')
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions')
  const [switchConfigOpen, setSwitchConfigOpen] = useState(false)
  const [status, setStatus] = useState<"preparing" | "opening" | "creating" | "error">("preparing")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const { data: repo } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: showSessionList && !!repoId,
  })

  const handleNavigate = useCallback((sessionId: string) => {
    setStatus("opening")
    navigate(`/repos/${repoId}/sessions/${sessionId}?assistant=1`)
  }, [navigate, repoId])

  const { openAssistant } = useAssistantSessionLauncher({
    repoId,
    opcodeUrl,
    onNavigate: handleNavigate,
  })

  const { data: assistantMode, isLoading: assistantModeLoading, error: assistantModeError } = useQuery({
    queryKey: ["repo", repoId, "assistant-mode"],
    queryFn: () => initializeAssistantMode(repoId),
    enabled: showSessionList && !!repoId,
  })

  const assistantDirectory = assistantMode?.directory
  const assistantFileBasePath = assistantDirectory?.split('/').filter(Boolean).at(-1)

  useSSE(opcodeUrl, assistantDirectory)

  const createSessionMutation = useCreateSession(opcodeUrl, assistantDirectory, (session) => {
    navigate(`/repos/${repoId}/sessions/${session.id}?assistant=1`)
  })

  const handleCreateSession = async () => {
    await createSessionMutation.mutateAsync({ agent: undefined })
  }

  useEffect(() => {
    let cancelled = false

    async function loadAndOpen() {
      try {
        if (showSessionList) return
        setStatus("preparing")
        if (!repoId) {
          const repos = await listRepos()
          const fallbackRepo = repos.sort((a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0))[0]
          if (!fallbackRepo) throw new Error("No repository available to open Assistant")
          navigate(`/repos/${fallbackRepo.id}/assistant`, { replace: true })
          return
        }

        await getRepo(repoId)
        if (cancelled) return
        setStatus("creating")
        await openAssistant()
      } catch (error) {
        if (cancelled) return
        setStatus("error")
        setErrorMessage(error instanceof Error ? error.message : "Failed to open Assistant")
      }
    }

    loadAndOpen()

    return () => {
      cancelled = true
    }
  }, [repoId, openAssistant, navigate, showSessionList])

  if (showSessionList) {
    return (
      <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
        <Header>
          <Header.BackButton to={`/repos/${repoId}`} />
          <Header.Title>Assistant</Header.Title>
          <Header.Actions>
            <div className="flex items-center gap-1">
              <PendingActionsGroup />
            </div>
            <Button onClick={() => handleCreateSession()} disabled={!opcodeUrl || !assistantDirectory || createSessionMutation.isPending} size="sm" className="hidden sm:inline-flex bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105">
              <Plus className="w-4 h-4 mr-2" />
              <span>New Session</span>
            </Button>
            <Button onClick={() => handleCreateSession()} disabled={!opcodeUrl || !assistantDirectory || createSessionMutation.isPending} size="sm" className="sm:hidden h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105">
              <Plus className="w-5 h-5" />
            </Button>
          </Header.Actions>
        </Header>
        <div className="flex-1 flex flex-col min-h-0">
          {assistantModeError ? (
            <div className="p-4 text-sm text-muted-foreground">Failed to load Assistant sessions</div>
          ) : assistantModeLoading || !assistantMode ? (
            <div className="p-4 text-sm text-muted-foreground">Loading Assistant sessions...</div>
          ) : (
            <SessionList
              opcodeUrl={opcodeUrl}
              directory={assistantDirectory}
              onSelectSession={(sessionId) => navigate(`/repos/${repoId}/sessions/${sessionId}?assistant=1`)}
            />
          )}
        </div>
        {assistantDirectory && (
          <>
            <FileBrowserSheet isOpen={fileBrowserOpen} onClose={() => setFileBrowserOpen(false)} basePath={assistantFileBasePath} repoName="Assistant" repoId={repoId} />
            <RepoMcpDialog open={mcpDialogOpen} onOpenChange={setMcpDialogOpen} directory={assistantDirectory} />
            <RepoSkillsDialog open={skillsDialogOpen} onOpenChange={setSkillsDialogOpen} repoId={repoId} />
            <SourceControlPanel repoId={repoId} isOpen={sourceControlOpen} onClose={() => setSourceControlOpen(false)} currentBranch={repo?.currentBranch || repo?.branch || "main"} repoName="Assistant" />
            <ResetPermissionsDialog open={resetPermissionsOpen} onOpenChange={setResetPermissionsOpen} repoId={repoId} repoDirectory={assistantDirectory} />
          </>
        )}
        {repo && (
          <SwitchConfigDialog
            open={switchConfigOpen}
            onOpenChange={setSwitchConfigOpen}
            repoId={repoId}
            currentConfigName={repo.openCodeConfigName}
            onConfigSwitched={(configName) => {
              queryClient.setQueryData(["repo", repoId], { ...repo, openCodeConfigName: configName })
              invalidateConfigCaches(queryClient)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center max-w-md px-4">
        {status === "error" ? (
          <>
            <p className="text-muted-foreground mb-4">{errorMessage}</p>
            <Button
              onClick={() => navigate(`/repos/${repoId}`)}
              variant="outline"
            >
              Go Back
            </Button>
            <Button
              onClick={() => window.location.reload()}
              className="ml-2"
            >
              Retry
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {status === "preparing" && "Preparing Assistant workspace..."}
              {status === "creating" && "Opening your last session chat..."}
              {status === "opening" && "Opening your last session chat..."}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
