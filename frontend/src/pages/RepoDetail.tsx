import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { SessionList } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { SwitchConfigDialog } from "@/components/repo/SwitchConfigDialog";
import { BackButton } from "@/components/ui/back-button";
import { useCreateSession } from "@/hooks/useOpenCode";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { useSwipeBack } from "@/hooks/useMobile";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, FolderOpen, GitBranch } from "lucide-react";

export function RepoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const repoId = parseInt(id || "0");
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [switchConfigOpen, setSwitchConfigOpen] = useState(false);
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

  

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = repo?.fullPath;

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

  const repoName = repo.repoUrl
    ? repo.repoUrl.split("/").pop()?.replace(".git", "") || "Repository"
    : repo.localPath || "Local Repository";
  const branchToDisplay = repo.currentBranch || repo.branch;
  const displayName = branchToDisplay ? `${repoName} (${branchToDisplay})` : repoName;
  const isNotMainBranch = branchToDisplay && branchToDisplay !== repo.defaultBranch;
  const currentBranch = repo.currentBranch || "main";

  return (
    <div 
      ref={pageRef}
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
      style={swipeStyles}
    >
      <div className="flex-shrink-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                {repoName}
              </h1>
              {!repo.isWorktree && branchToDisplay ? (
                <BranchSwitcher
                  repoId={repoId}
                  currentBranch={currentBranch}
                  isWorktree={repo.isWorktree}
                  repoUrl={repo.repoUrl}
                  className="sm:w-[140px] sm:max-w-[140px]"
                  iconOnly
                />
              ) : branchToDisplay ? (
                <Badge
                  className={`text-xs px-2.5 py-0.5 ${
                    repo.isWorktree
                      ? "bg-purple-600/20 text-purple-400 border-purple-600/40"
                      : isNotMainBranch
                      ? "bg-blue-600/20 text-blue-400 border-blue-600/40"
                      : "bg-zinc-600/20 text-zinc-400 border-zinc-600/40"
                  }`}
                  title={repo.isWorktree ? "Worktree" : branchToDisplay}
                >
                  {repo.isWorktree && <GitBranch className="h-3 w-3 mr-1" />}
                  {branchToDisplay}
                </Badge>
              ) : null}
            </div>
          </div>
           <div className="flex items-center gap-2">
             

             <Button
               variant="outline"
               onClick={() => setFileBrowserOpen(true)}
               size="sm"
               className="text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
             >
               <FolderOpen className="w-4 h-4 sm:mr-2" />
               <span className="hidden sm:inline">Files</span>
             </Button>
              <Button
                onClick={() => handleCreateSession()}
                disabled={!opcodeUrl || createSessionMutation.isPending}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
              >
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">New Session</span>
              </Button>
           </div>
        </div>
      </div>

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
            }}
          />
        )}
    </div>
  );
}
