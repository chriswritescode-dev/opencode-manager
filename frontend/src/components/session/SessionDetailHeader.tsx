import { BackButton } from "@/components/ui/back-button";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EditSessionTitleDialog } from "@/components/session/EditSessionTitleDialog";
import { Loader2, Settings, CornerUpLeft, Plug, FolderOpen, MoreVertical, Upload, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useMobile } from "@/hooks/useMobile";

interface Repo {
  id: number;
  repoUrl?: string | null;
  fullPath: string;
  localPath: string;
  currentBranch?: string;
  isWorktree?: boolean;
  isLocal?: boolean;
  cloneStatus: 'ready' | 'cloning' | 'error';
}

interface SessionDetailHeaderProps {
  repo: Repo;
  sessionId: string;
  sessionTitle: string;
  repoId: number;
  isConnected: boolean;
  isReconnecting?: boolean;
  opcodeUrl: string | null;
  repoDirectory: string | undefined;
  parentSessionId?: string;
  isTitleGenerating?: boolean;
  onFileBrowserOpen: () => void;
  onSettingsOpen: () => void;
  onMcpDialogOpen: () => void;
  onSessionTitleUpdate: (newTitle: string) => void;
  onParentSessionClick?: () => void;
  onAttachFile?: () => void;
}

export function SessionDetailHeader({
  repo,
  sessionId,
  sessionTitle,
  repoId,
  isConnected,
  isReconnecting,
  opcodeUrl,
  repoDirectory,
  parentSessionId,
  isTitleGenerating,
  onFileBrowserOpen,
  onSettingsOpen,
  onMcpDialogOpen,
  onSessionTitleUpdate,
  onParentSessionClick,
  onAttachFile,
}: SessionDetailHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const isMobile = useMobile();
  const [editTitle, setEditTitle] = useState(sessionTitle);

  useEffect(() => {
    if (!isEditing) {
      setEditTitle(sessionTitle);
    }
  }, [sessionTitle, isEditing]);

  if (repo.cloneStatus !== 'ready') {
    return (
      <div className="sticky top-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-2 sm:px-4 py-1.5 sm:py-2">
        <div className="flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">
            {repo.cloneStatus === 'cloning' ? 'Cloning repository...' : 'Repository not ready'}
          </span>
        </div>
      </div>
    );
  }

  const repoName = repo.repoUrl?.split("/").pop()?.replace(".git", "") || repo.localPath || "Repository";
  const currentBranch = repo.currentBranch || "main";

  const handleTitleClick = () => {
    setIsEditing(true);
    setEditTitle(sessionTitle);
  };

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitle.trim() && editTitle !== sessionTitle) {
      onSessionTitleUpdate(editTitle.trim());
    }
    setIsEditing(false);
  };

  

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditTitle(sessionTitle);
      setIsEditing(false);
    } else if (e.key === 'Enter') {
      handleTitleSubmit(e);
    }
  };

  

  

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-2 sm:px-4 py-1.5 sm:py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
          {parentSessionId ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onParentSessionClick}
                className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/20 h-7 px-2 gap-1"
                title="Back to parent session"
              >
                <CornerUpLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-xs">Parent</span>
              </Button>
              <div className="hidden sm:block">
                <BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
              </div>
            </>
          ) : (
            <BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
          )}
          <div className="min-w-0 flex-1">
            {isMobile && (
              <EditSessionTitleDialog
                isOpen={isEditing}
                currentTitle={sessionTitle}
                onClose={() => setIsEditing(false)}
                onSave={(newTitle) => {
                  onSessionTitleUpdate(newTitle);
                  setIsEditing(false);
                }}
              />
            )}
            {isEditing && !isMobile ? (
              <form onSubmit={handleTitleSubmit} className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={(e) => {
                    if (!e.relatedTarget?.closest('button')) {
                      handleTitleSubmit(e);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  className="text-[16px] sm:text-base font-semibold bg-background border border-border rounded-l px-2 py-1 outline-none w-full truncate focus:border-primary sm:max-w-[250px] h-7"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-l-none border border-l-0 border-border hover:bg-accent flex-shrink-0 mt-0"
                  onClick={() => setEditTitle("")}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </form>
            ) : (
              <>
                {isTitleGenerating ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-xs sm:text-base text-muted-foreground italic">Generating title...</span>
                  </div>
                ) : (
                  <h1 
                    className="text-xs text-green-500 sm:text-base font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleTitleClick}
                  >
                    {sessionTitle}
                  </h1>
                )}
                <p className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 truncate">
                  {repoName}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div>
            <ContextUsageIndicator
              opcodeUrl={opcodeUrl}
              sessionID={sessionId}
              directory={repoDirectory}
              isConnected={isConnected}
              isReconnecting={isReconnecting}
            />
          </div>
          <BranchSwitcher
            repoId={repoId}
            currentBranch={currentBranch}
            isWorktree={repo.isWorktree}
            repoUrl={repo.repoUrl}
            repoLocalPath={repo.localPath}
            className="hidden sm:flex max-w-[80px] sm:w-[140px] sm:max-w-[140px]"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onFileBrowserOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Files"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onMcpDialogOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="MCP Servers"
          >
            <Plug className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
                title="Options"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5">
                <BranchSwitcher
                  repoId={repoId}
                  currentBranch={currentBranch}
                  isWorktree={repo.isWorktree}
                  repoUrl={repo.repoUrl}
                  repoLocalPath={repo.localPath}
                  iconOnly={false}
                  className="w-full"
                />
              </div>
              <div className="h-px bg-border my-1" />
              <DropdownMenuItem onClick={onFileBrowserOpen}>
                <FolderOpen className="w-4 h-4 mr-2" /> Files
              </DropdownMenuItem>
              {onAttachFile && (
                <DropdownMenuItem onClick={onAttachFile}>
                  <Upload className="w-4 h-4 mr-2" /> Upload
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onMcpDialogOpen}>
                <Plug className="w-4 h-4 mr-2" /> MCP
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSettingsOpen}>
                <Settings className="w-4 h-4 mr-2" /> Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
