import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { SessionList } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { SwitchConfigDialog } from "@/components/repo/SwitchConfigDialog";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { SourceControlPanel } from "@/components/source-control";
import { useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useSSE } from "@/hooks/useSSE";
import { useDialogParam } from "@/hooks/useDialogParam";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Loader2 } from "lucide-react";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { invalidateConfigCaches } from "@/lib/queryInvalidation";
import { getRepoDisplayName } from "@/lib/utils";
import { useSidebarAction } from "@/hooks/useSidebarAction";

export function RepoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const repoId = Number(id) || 0;
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [switchConfigOpen, setSwitchConfigOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  useRepoActivity(repoId, Boolean(repo));

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = repo?.fullPath;

  useSSE(opcodeUrl, repoDirectory);

  const createSessionMutation = useCreateSession(opcodeUrl, repoDirectory, (session) => {
    navigate(`/repos/${repoId}/sessions/${session.id}`);
  });

  const handleCreateSession = async (options?: {
    agentSlug?: string;
    promptSlug?: string;
  }) => {
    await createSessionMutation.mutateAsync({
      agent: options?.agentSlug,
    });
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(`/repos/${repoId}/sessions/${sessionId}`);
  };

  useSidebarAction('new-session', () => {
    handleCreateSession();
  });

  if (repoLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">
          Repository not found
        </p>
      </div>
    );
  }
  
  if (repo.cloneStatus !== 'ready') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {repo.cloneStatus === 'cloning' ? 'Cloning repository...' : 'Repository not ready'}
          </p>
        </div>
      </div>
    );
  }

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath);
  const branchToDisplay = repo.currentBranch || repo.branch;
  const displayName = branchToDisplay ? `${repoName} (${branchToDisplay})` : repoName;
  const currentBranch = repo.currentBranch || repo.branch || "main";
  const isWorktree = repo.isWorktree || false;

  return (
    <div
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0"
    >
      <Header>
        <Header.BackButton to="/" />
        <div className="flex items-center gap-2 min-w-0">
          <Header.Title>{repoName}</Header.Title>
          {isWorktree ? (
            <Badge className="text-xs px-1.5 sm:px-2.5 py-0.5 bg-purple-600/20 text-purple-400 border-purple-600/40" title="Worktree">
              <GitBranch className="h-3 w-3 sm:mr-1" />
              <span className="hidden sm:inline">WT: {currentBranch}</span>
            </Badge>
          ) : null}
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button
            onClick={() => handleCreateSession()}
            disabled={!opcodeUrl || createSessionMutation.isPending}
            size="sm"
            className="sm:hidden h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </Header.Actions>
      </Header>

      <div className="flex-1 flex flex-col min-h-0">
        {opcodeUrl && repoDirectory && (
          <SessionList
            opcodeUrl={opcodeUrl}
            directory={repoDirectory}
            onSelectSession={handleSelectSession}
          />
        )}
      </div>

      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        basePath={repo.localPath}
        repoName={displayName}
        repoId={repoId}
        allowNavigateAboveBase={true}
      />

      <RepoMcpDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={repoDirectory}
      />

      <RepoSkillsDialog
        open={skillsDialogOpen}
        onOpenChange={setSkillsDialogOpen}
        repoId={repoId}
      />

      <SourceControlPanel
        repoId={repoId}
        isOpen={sourceControlOpen}
        onClose={() => setSourceControlOpen(false)}
        currentBranch={currentBranch}
        repoName={repoName}
      />

{repo && (
          <SwitchConfigDialog
            open={switchConfigOpen}
            onOpenChange={setSwitchConfigOpen}
            repoId={repoId}
            currentConfigName={repo.openCodeConfigName}
            onConfigSwitched={(configName) => {
              queryClient.setQueryData(["repo", repoId], {
                ...repo,
                openCodeConfigName: configName,
              });
              invalidateConfigCaches(queryClient);
            }}
          />
        )}

      <ResetPermissionsDialog
        open={resetPermissionsOpen}
        onOpenChange={setResetPermissionsOpen}
        repoId={repoId}
        repoDirectory={repoDirectory}
      />
    </div>
  );
}
