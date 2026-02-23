import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { settingsApi } from "@/api/settings";
import { SessionList } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { SwitchConfigDialog } from "@/components/repo/SwitchConfigDialog";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { SourceControlPanel } from "@/components/source-control";
import { useCreateSession } from "@/hooks/useOpenCode";
import { useSSE } from "@/hooks/useSSE";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { useSwipeBack } from "@/hooks/useMobile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Plug, FolderOpen, Plus, GitBranch, GitCommitHorizontal, ShieldOff, Brain, Loader2 } from "lucide-react";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { invalidateConfigCaches } from "@/lib/queryInvalidation";
import { getRepoDisplayName } from "@/lib/utils";
export function RepoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const repoId = Number(id) || 0;
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [switchConfigOpen, setSwitchConfigOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [sourceControlOpen, setSourceControlOpen] = useState(false);
  const [resetPermissionsOpen, setResetPermissionsOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  
  const handleSwipeBack = useCallback(() => {
    navigate("/");
  }, [navigate]);
  
  const { bind: bindSwipe, swipeStyles } = useSwipeBack(handleSwipeBack, {
    enabled: !fileBrowserOpen && !switchConfigOpen,
  });
  
  useEffect(() => {
    return bindSwipe(pageRef.current);
  }, [bindSwipe]);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  const { data: memoryPluginStatus } = useQuery({
    queryKey: ["memory-plugin-status"],
    queryFn: () => settingsApi.getMemoryPluginStatus(),
    staleTime: 60000,
  });

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = repo?.fullPath;

  useSSE(opcodeUrl, repoDirectory);

  const createSessionMutation = useCreateSession(opcodeUrl, repoDirectory);

  const handleCreateSession = async (options?: {
    agentSlug?: string;
    promptSlug?: string;
  }) => {
    const session = await createSessionMutation.mutateAsync({
      agent: options?.agentSlug,
    });
    navigate(`/repos/${repoId}/sessions/${session.id}`);
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(`/repos/${repoId}/sessions/${sessionId}`);
  };

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

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath);
  const branchToDisplay = repo.currentBranch || repo.branch;
  const displayName = branchToDisplay ? `${repoName} (${branchToDisplay})` : repoName;
  const currentBranch = repo.currentBranch || repo.branch || "main";
  const isWorktree = repo.isWorktree || false;

  return (
    <div
      ref={pageRef}
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
      style={swipeStyles}
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
        <div className="hidden sm:flex items-center gap-1">
          <PendingActionsGroup />
        </div>
        <Button
          variant="outline"
          onClick={() => setMcpDialogOpen(true)}
          size="sm"
          className="hidden md:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
        >
          <Plug className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">MCP</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setSourceControlOpen(true)}
          size="sm"
          className="hidden md:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
        >
          <GitCommitHorizontal className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Source</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setFileBrowserOpen(true)}
          size="sm"
          className="hidden md:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
        >
          <FolderOpen className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Files</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setResetPermissionsOpen(true)}
          size="sm"
          className="hidden lg:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
        >
          <ShieldOff className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Reset Permissions</span>
        </Button>
        {memoryPluginStatus?.memoryPluginEnabled && (
          <Button
            variant="outline"
            onClick={() => navigate(`/repos/${repoId}/memories`)}
            size="sm"
            className="hidden md:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <Brain className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Memory</span>
          </Button>
        )}
        <Header.MobileDropdown>
          {memoryPluginStatus?.memoryPluginEnabled && (
            <DropdownMenuItem onClick={() => navigate(`/repos/${repoId}/memories`)}>
              <Brain className="w-4 h-4 mr-2" /> Memory
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setSourceControlOpen(true)}>
            <GitCommitHorizontal className="w-4 h-4 mr-2" /> Source Control
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMcpDialogOpen(true)}>
            <Plug className="w-4 h-4 mr-2" /> MCP
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setFileBrowserOpen(true)}>
            <FolderOpen className="w-4 h-4 mr-2" /> Files
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setResetPermissionsOpen(true)}>
            <ShieldOff className="w-4 h-4 mr-2" /> Reset Permissions
          </DropdownMenuItem>
        </Header.MobileDropdown>
        <Button
          onClick={() => handleCreateSession()}
          disabled={!opcodeUrl || createSessionMutation.isPending}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
        >
          <Plus className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">New Session</span>
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
      />

      <RepoMcpDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={repoDirectory}
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
