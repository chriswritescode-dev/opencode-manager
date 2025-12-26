import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BackButton } from "@/components/ui/back-button";
import { Plus, FolderOpen, GitBranch, Plug, MoreVertical } from "lucide-react";

interface RepoDetailHeaderProps {
  repoName: string;
  repoId: number;
  currentBranch: string | null;
  isWorktree: boolean;
  repoUrl: string | null;
  onMcpClick: () => void;
  onFilesClick: () => void;
  onNewSession: () => void;
  disabledNewSession?: boolean;
}

export function RepoDetailHeader({
  repoName,
  repoId,
  currentBranch,
  isWorktree,
  repoUrl,
  onMcpClick,
  onFilesClick,
  onNewSession,
  disabledNewSession,
}: RepoDetailHeaderProps) {
  const branchToDisplay = isWorktree ? (currentBranch ? `WT: ${currentBranch}` : "Worktree") : currentBranch
  const isNotMainBranch = currentBranch && currentBranch !== "main" && currentBranch !== "master"

  return (
    <div className="flex-shrink-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <BackButton />
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base truncate max-w-[200px] sm:max-w-none font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              {repoName}
            </h1>
            {!isWorktree && currentBranch && branchToDisplay ? (
              <BranchSwitcher
                repoId={repoId}
                currentBranch={currentBranch}
                isWorktree={isWorktree}
                repoUrl={repoUrl}
                className="hidden sm:flex w-[140px] max-w-[140px]"
                iconOnly
              />
            ) : branchToDisplay ? (
              <Badge
                className={`text-xs px-1.5 sm:px-2.5 py-0.5 ${
                  isWorktree
                    ? "bg-purple-600/20 text-purple-400 border-purple-600/40"
                    : isNotMainBranch
                    ? "bg-blue-600/20 text-blue-400 border-blue-600/40"
                    : "bg-zinc-600/20 text-zinc-400 border-zinc-600/40"
                }`}
                title={isWorktree ? "Worktree" : branchToDisplay}
              >
                {isWorktree && <GitBranch className="h-3 w-3 sm:mr-1" />}
                <span className="hidden sm:inline">{branchToDisplay}</span>
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onMcpClick}
            size="sm"
            className="hidden sm:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <Plug className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">MCP</span>
          </Button>
          <Button
            variant="outline"
            onClick={onFilesClick}
            size="sm"
            className="hidden sm:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <FolderOpen className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Files</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="sm:hidden text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
              >
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isWorktree && currentBranch && (
                <>
                  <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                    <BranchSwitcher
                      repoId={repoId}
                      currentBranch={currentBranch}
                      isWorktree={isWorktree}
                      repoUrl={repoUrl}
                      iconOnly={false}
                    />
                  </DropdownMenuItem>
                  <div className="h-px bg-border my-1" />
                </>
              )}
              <DropdownMenuItem onClick={onMcpClick}>
                <Plug className="w-4 h-4 mr-2" /> MCP
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onFilesClick}>
                <FolderOpen className="w-4 h-4 mr-2" /> Files
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={onNewSession}
            disabled={disabledNewSession}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
          >
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Session</span>
          </Button>
        </div>
      </div>
    </div>
  )
}