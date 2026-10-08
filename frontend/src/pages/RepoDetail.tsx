import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { SessionList, type SessionListRenderArgs } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { ProjectActionsMenu } from "@/components/repo/ProjectActionsMenu";
import { RepoActionsDialog } from "@/components/repo/RepoActionsDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { MultiRunSheet } from "@/components/repo/MultiRunSheet";
import { SourceControlPanel } from "@/components/source-control";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useCreateRepoWorkspace, useDeleteRepoWorkspaces, useRepoSiblings } from "@/hooks/useRepoSiblings";
import { useSSE } from "@/hooks/useSSE";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useOpenTerminal, useTerminalDialogParam, useTerminalDirectoryParam } from "@/hooks/useOpenTerminal";
import { useWorktreeTab } from "@/hooks/useWorktreeTab";
import { WorktreeTabs } from "@/components/repo/WorktreeTabs";
import { WorktreeSessionGroups } from "@/components/repo/WorktreeSessionGroups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Loader2, Layers, Columns3 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { getRepoDisplayName } from "@/lib/utils";
import { notifyWorktreeSetup } from "@/lib/worktreeSetup";
import { getRepoDirectoryNameError, isWorktreeSibling } from "@opencode-manager/shared/utils";

export function RepoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repoId = Number(id) || 0;
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [terminalOpen, setTerminalOpen] = useTerminalDialogParam();
  const [actionsDialogOpen, setActionsDialogOpen] = useDialogParam('actions');
  const [previewOpen, setPreviewOpen] = useDialogParam('preview');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [multiRunOpen, setMultiRunOpen] = useDialogParam('multiRun');
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const { activeTab, setActiveTab } = useWorktreeTab();
  const openTerminal = useOpenTerminal();
  const terminalDirectory = useTerminalDirectoryParam();

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  useRepoActivity(repoId, Boolean(repo));

  const { data: siblings } = useRepoSiblings(repoId);
  const deleteWorkspaces = useDeleteRepoWorkspaces(repoId);
  const createWorkspace = useCreateRepoWorkspace(repoId);

  const workspaceSiblings = useMemo(
    () => (siblings ?? []).filter((sibling) => isWorktreeSibling(sibling) && !!sibling.fullPath),
    [siblings],
  );

  const scheduleDirectorySet = useMemo(
    () => new Set(
      workspaceSiblings
        .filter((sibling) => sibling.worktreeSource === 'schedule')
        .map((sibling) => sibling.fullPath),
    ),
    [workspaceSiblings],
  );

  const nonScheduleWorkspaceDirectories = useMemo(
    () => workspaceSiblings
      .filter((sibling) => sibling.worktreeSource !== 'schedule')
      .map((sibling) => sibling.fullPath)
      .filter(Boolean),
    [workspaceSiblings],
  );

  const [expandedScheduleDirectories, setExpandedScheduleDirectories] = useState<string[]>([]);

  const activeScheduleDirectories = useMemo(
    () => expandedScheduleDirectories.filter((directory) => scheduleDirectorySet.has(directory)),
    [expandedScheduleDirectories, scheduleDirectorySet],
  );

  const handleExpandedScheduleDirectoriesChange = useCallback((directories: string[]) => {
    setExpandedScheduleDirectories((current) =>
      current.length === directories.length && current.every((directory, index) => directory === directories[index])
        ? current
        : directories,
    );
  }, []);

  const baseDirectory = repo?.fullPath;
  const subscriptionDirectories = useMemo(() => {
    const set = new Set<string>();
    if (baseDirectory) set.add(baseDirectory);
    nonScheduleWorkspaceDirectories.forEach((dir) => set.add(dir));
    activeScheduleDirectories.forEach((dir) => set.add(dir));
    return Array.from(set);
  }, [baseDirectory, nonScheduleWorkspaceDirectories, activeScheduleDirectories]);

  const showWorktrees = activeTab === 'workspaces';
  const sessionListDirectories = useMemo(() => {
    if (!showWorktrees) return baseDirectory ? [baseDirectory] : [];
    return Array.from(new Set([...nonScheduleWorkspaceDirectories, ...activeScheduleDirectories]));
  }, [showWorktrees, baseDirectory, nonScheduleWorkspaceDirectories, activeScheduleDirectories]);

  useEffect(() => {
    if (!showWorktrees) setExpandedScheduleDirectories([]);
  }, [showWorktrees]);

  useSSE(subscriptionDirectories);

  const sessionUrl = useCallback(
    (sessionId: string, inWorktree: boolean) => {
      const base = `/repos/${repoId}/sessions/${sessionId}`;
      return inWorktree ? `${base}?repoTab=workspaces` : base;
    },
    [repoId],
  );

  const createSessionMutation = useCreateSession(baseDirectory);

  const handleCreateSession = (directory = baseDirectory) => {
    createSessionMutation.mutate({ directory }, {
      onSuccess: (session) => navigate(sessionUrl(session.id, directory !== baseDirectory)),
    });
  };

  const handleCreateWorkspace = (name: string) => {
    createWorkspace.mutate(name ? { name } : {}, {
      onSuccess: (workspace) => {
        setCreateWorkspaceOpen(false);
        notifyWorktreeSetup(workspace.worktreeSetup);
        if (workspace.worktreeSetup?.status === 'started') {
          const terminalId = workspace.worktreeSetup.terminal.id;
          openTerminal(terminalId, { repoTab: 'workspaces', ...(workspace.directory ? { terminalDirectory: workspace.directory } : {}) });
          return;
        }
        setActiveTab('workspaces');
      },
    });
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(sessionUrl(sessionId, showWorktrees));
  };

  const renderWorktreeGroups = ({ sessions, searchQuery, renderSessionCard }: SessionListRenderArgs) => (
    <WorktreeSessionGroups
      repoId={repoId}
      worktrees={workspaceSiblings}
      sessions={sessions}
      searchQuery={searchQuery}
      renderSessionCard={renderSessionCard}
      onExpandedScheduleDirectoriesChange={handleExpandedScheduleDirectoriesChange}
      onNewSession={handleCreateSession}
      onOpenTerminal={(directory) => openTerminal(null, { repoTab: "workspaces", terminalDirectory: directory })}
      onCreateWorktree={() => setCreateWorkspaceOpen(true)}
      onDelete={(directories) => deleteWorkspaces.mutate(directories)}
      isDeleting={deleteWorkspaces.isPending}
    />
  );

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

  const repoName = getRepoDisplayName(repo);
  const branchToDisplay = repo.currentBranch || repo.branch;
  const displayName = branchToDisplay ? `${repoName} (${branchToDisplay})` : repoName;
  const currentBranch = repo.currentBranch || repo.branch || "main";
  const isWorktree = repo.isWorktree || false;

  return (
    <div
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0"
    >
      <Header>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Header.BackButton to="/" />
          <Header.Title>{repoName}</Header.Title>
          {isWorktree ? (
            <Badge className="text-xs px-1.5 sm:px-2.5 py-0.5 bg-primary/20 text-primary border-primary/40" title="Worktree">
              <GitBranch className="h-3 w-3 sm:mr-1" />
              <span className="hidden sm:inline">WT: {currentBranch}</span>
            </Badge>
          ) : null}
        </div>
        <Header.Actions className="shrink-0 gap-1 sm:gap-2 pl-2">
          <div className="flex items-center gap-0.5 sm:gap-1">
            <ProjectActionsMenu repoId={repoId} directory={baseDirectory} />
            <PendingActionsGroup />
            <Button
              onClick={() => setMultiRunOpen(true)}
              aria-label="Multi-run"
              variant="ghost"
              size="icon"
              className="sm:hidden h-10 w-10 text-muted-foreground hover:text-foreground"
            >
              <Columns3 className="w-5 h-5" />
            </Button>
          </div>
          <Button
            onClick={() => setMultiRunOpen(true)}
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex h-9"
          >
            <Columns3 className="w-4 h-4 mr-2" />
            <span>Multi-run</span>
          </Button>
          <Button
            onClick={() => handleCreateSession()}
            disabled={createSessionMutation.isPending}
            size="sm"
            className="hidden sm:inline-flex bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200 hover:scale-105"
          >
            <Plus className="w-4 h-4 mr-2" />
            <span>New Session</span>
          </Button>
          <Button
            onClick={() => handleCreateSession()}
            disabled={createSessionMutation.isPending}
            aria-label="New Session"
            size="sm"
            className="sm:hidden h-10 w-10 p-0 bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200 hover:scale-105"
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
        onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {(showWorktrees || sessionListDirectories.length > 0) && (
          <SessionList
            key={showWorktrees ? "worktrees" : "repo"}
            directories={sessionListDirectories}
            createDirectory={baseDirectory}
            onSelectSession={handleSelectSession}
            renderSessions={showWorktrees ? renderWorktreeGroups : undefined}
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
        directory={baseDirectory}
      />

      <RepoActionsDialog
        repoId={repoId}
        directory={baseDirectory}
        open={actionsDialogOpen}
        onOpenChange={setActionsDialogOpen}
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

      <TerminalPanel
        repoId={repoId}
        directory={terminalDirectory ?? baseDirectory}
        isOpen={terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />

      <PreviewPanel
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        directory={baseDirectory}
      />

      <ResetPermissionsDialog
        open={resetPermissionsOpen}
        onOpenChange={setResetPermissionsOpen}
        repoId={repoId}
      />

      <MultiRunSheet
        repoId={repoId}
        directory={baseDirectory}
        defaultBaseRef={currentBranch}
        open={multiRunOpen}
        onOpenChange={setMultiRunOpen}
      />
    </div>
  );
}

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  isCreating: boolean;
}

function CreateWorkspaceDialog({ open, onOpenChange, onCreate, isCreating }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("");
  const trimmedName = name.trim();
  const nameError = trimmedName ? getRepoDirectoryNameError(trimmedName) : null;

  const handleOpenChange = (next: boolean) => {
    if (!next) setName("");
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (nameError || isCreating) return;
    onCreate(trimmedName);
  };

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
  );
}
