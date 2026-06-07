import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRepo, workspaceLabel } from "@/api/repos";
import { SessionList } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { SwitchConfigDialog } from "@/components/repo/SwitchConfigDialog";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { SourceControlPanel } from "@/components/source-control";
import { useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useCreateRepoWorkspace, useDeleteRepoWorkspaces, useRepoSiblings } from "@/hooks/useRepoSiblings";
import { useSSE } from "@/hooks/useSSE";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useWorktreeTab } from "@/hooks/useWorktreeTab";
import { WorktreeTabs } from "@/components/repo/WorktreeTabs";
import { WorkspaceManager } from "@/components/repo/WorkspaceManager";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Loader2, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [activeWorkspaceDirectory, setActiveWorkspaceDirectory] = useState<string | undefined>();
  const { activeTab, setActiveTab } = useWorktreeTab();

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  useRepoActivity(repoId, Boolean(repo));

  const { data: siblings } = useRepoSiblings(repoId);
  const deleteWorkspaces = useDeleteRepoWorkspaces(repoId);
  const createWorkspace = useCreateRepoWorkspace(repoId);

  const opcodeUrl = OPENCODE_API_ENDPOINT;

  const workspaceSiblings = useMemo(
    () => (siblings ?? []).filter((sibling) => !!sibling.workspaceId && !!sibling.fullPath),
    [siblings],
  );

  const workspaceDirectories = useMemo(
    () => workspaceSiblings.map((sibling) => sibling.fullPath).filter(Boolean),
    [workspaceSiblings],
  );

  const baseDirectory = repo?.fullPath;
  const subscriptionDirectories = useMemo(() => {
    const set = new Set<string>();
    if (baseDirectory) set.add(baseDirectory);
    workspaceDirectories.forEach((dir) => set.add(dir));
    return Array.from(set);
  }, [baseDirectory, workspaceDirectories]);

  useEffect(() => {
    if (workspaceDirectories.length === 0) {
      setActiveWorkspaceDirectory(undefined);
      return;
    }

    setActiveWorkspaceDirectory((current) => (
      current && workspaceDirectories.includes(current) ? current : workspaceDirectories[0]
    ));
  }, [workspaceDirectories]);

  const workspaceComposerDirectory = activeWorkspaceDirectory ?? workspaceDirectories[0];
  const sessionListDirectories = activeTab === 'workspaces' ? workspaceDirectories : (baseDirectory ? [baseDirectory] : []);
  const composerDirectory = activeTab === 'workspaces' ? workspaceComposerDirectory : baseDirectory;

  const directoryLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    workspaceSiblings.forEach((sibling) => {
      if (sibling.fullPath) {
        labels[sibling.fullPath] = workspaceLabel(sibling);
      }
    });
    return labels;
  }, [workspaceSiblings]);

  const activeWorkspaceLabel = activeWorkspaceDirectory ? directoryLabels[activeWorkspaceDirectory] : undefined;

  useSSE(opcodeUrl, subscriptionDirectories);

  const sessionUrl = useCallback(
    (sessionId: string) => {
      const base = `/repos/${repoId}/sessions/${sessionId}`;
      return activeTab === 'workspaces' ? `${base}?repoTab=workspaces` : base;
    },
    [repoId, activeTab],
  );

  const createSessionMutation = useCreateSession(opcodeUrl, composerDirectory, (session) => {
    navigate(sessionUrl(session.id));
  });

  const handleCreateSession = async (options?: {
    agentSlug?: string;
    promptSlug?: string;
  }) => {
    if (activeTab === 'workspaces' && !workspaceComposerDirectory) {
      setCreateWorkspaceOpen(true);
      return;
    }

    await createSessionMutation.mutateAsync({
      agent: options?.agentSlug,
    });
  };

  const handleCreateWorkspace = async () => {
    const workspace = await createWorkspace.mutateAsync();
    if (workspace.directory) {
      setActiveWorkspaceDirectory(workspace.directory);
    }
    setActiveTab('workspaces');
    setCreateWorkspaceOpen(false);
  };

  const handleOpenWorkspaceSelector = () => {
    if (workspaceSiblings.length === 0) {
      setCreateWorkspaceOpen(true);
      return;
    }
    setActiveTab('workspaces');
    setWorkspaceSelectorOpen(true);
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(sessionUrl(sessionId));
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

      <WorktreeTabs
        workspaces={workspaceSiblings}
        value={activeTab}
        onValueChange={setActiveTab}
        baseLabel={currentBranch}
        activeWorkspaceLabel={activeWorkspaceLabel}
        onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
        onWorkspaceMenu={handleOpenWorkspaceSelector}
      />

      <WorkspaceManager
        open={workspaceSelectorOpen}
        onOpenChange={setWorkspaceSelectorOpen}
        workspaces={workspaceSiblings}
        activeWorkspaceDirectory={activeWorkspaceDirectory}
        onActiveWorkspaceChange={setActiveWorkspaceDirectory}
        onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
        onDelete={(workspaceIds) => deleteWorkspaces.mutate(workspaceIds)}
        isDeleting={deleteWorkspaces.isPending}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {opcodeUrl && sessionListDirectories.length > 0 && (
          <SessionList
            opcodeUrl={opcodeUrl}
            directories={sessionListDirectories}
            directoryLabels={activeTab === 'workspaces' ? directoryLabels : undefined}
            createDirectory={activeTab === 'workspaces' ? workspaceComposerDirectory : baseDirectory}
            onSelectSession={handleSelectSession}
          />
        )}
      </div>

      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
        onCreate={handleCreateWorkspace}
        isCreating={createWorkspace.isPending}
      />

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
        directory={composerDirectory}
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
      />
    </div>
  );
}

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => Promise<void>;
  isCreating: boolean;
}

function CreateWorkspaceDialog({ open, onOpenChange, onCreate, isCreating }: CreateWorkspaceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-purple-400" />
            Create Workspace
          </DialogTitle>
          <DialogDescription>
            Create an OpenCode worktree workspace for this repository.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <GitBranch className="h-4 w-4 text-purple-400" />
            Worktree
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            OpenCode will create and manage a git worktree workspace.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={() => { void onCreate(); }} disabled={isCreating} className="bg-blue-600 hover:bg-blue-700 text-white">
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Workspace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
