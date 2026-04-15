import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, GitBranch, FolderOpen, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { getRepoDisplayName } from "@/lib/utils";
import type { GitStatusResponse } from "@/types/git"
import { RepoRowActions } from "./RepoRowActions"

interface RepoCardProps {
  repo: {
    id: number;
    repoUrl?: string | null;
    localPath?: string;
    sourcePath?: string;
    branch?: string;
    currentBranch?: string;
    cloneStatus: string;
    isWorktree?: boolean;
    isLocal?: boolean;
    fullPath?: string;
    lastAccessedAt?: number;
  };
  onDelete: (id: number) => void;
  isDeleting: boolean;
  isSelected?: boolean;
  onSelect?: (id: number, selected: boolean) => void;
  gitStatus?: GitStatusResponse;
  manageMode?: boolean;
  isMobile?: boolean;
  activityLabel?: string;
  hasSelectedRepos?: boolean;
}

export function RepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected = false,
  onSelect,
  gitStatus,
  manageMode = false,
  isMobile = false,
  activityLabel,
  hasSelectedRepos = false,
}: RepoCardProps) {
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath);
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch;
  const isReady = repo.cloneStatus === "ready";
  const isCloning = repo.cloneStatus === "cloning";

  const isDirty = gitStatus?.hasChanges || false;
  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const stagedCount = gitStatus?.files?.filter((f) => f.staged).length || 0;
  const unstagedCount = gitStatus?.files?.filter((f) => !f.staged).length || 0;

  const handleCardClick = () => {
    if (isReady && !actionsOpen) {
      navigate(`/repos/${repo.id}`);
    }
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <div
      onClick={handleCardClick}
      className={`relative border rounded-xl overflow-hidden transition-all duration-200 w-full ${
        isReady ? "cursor-pointer active:scale-[0.98] hover:border-blue-500/50 hover:bg-accent/50 hover:shadow-md" : "cursor-default"
      } ${
        isSelected
          ? "border-blue-500 bg-blue-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="p-2">
        <div>
          <div className="flex items-start gap-3 mb-1">
            {onSelect && (
              <div
                onClick={(e) => handleActionClick(e, () => onSelect(repo.id, !isSelected))}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelect(repo.id, checked === true)}
                  className="w-5 h-5"
                />
              </div>
            )}

            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h3 className="font-semibold text-base text-foreground truncate">
                {repoName}
              </h3>
              {isReady && (
                <div className={`w-2 h-2 rounded-full shrink-0 ${isDirty ? 'bg-orange-500' : 'bg-green-500'}`} />
              )}
            </div>

            {!manageMode && !isSelected && !hasSelectedRepos && (
              <RepoRowActions
                repo={repo}
                gitStatus={gitStatus}
                onDelete={onDelete}
                isDeleting={isDeleting}
                isMobile={isMobile}
                onActionsOpenChange={setActionsOpen}
              />
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
              {isCloning ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  Cloning...
                </span>
              ) : (
                <>
                  <span className={`flex items-center gap-1 shrink-0 ${repo.isWorktree ? 'text-purple-400' : ''}`}>
                    <GitBranch className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[80px]">{branchToDisplay || "main"}</span>
                  </span>
                  {isDirty && (
                    <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400 shrink-0">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs whitespace-nowrap">
                        {unstagedCount > 0 && unstagedCount}
                        {unstagedCount > 0 && stagedCount > 0 && "/"}
                        {stagedCount > 0 && `${stagedCount}s`}
                      </span>
                    </span>
                  )}
                  {(ahead > 0 || behind > 0) && (
                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 shrink-0">
                      <span className="text-xs whitespace-nowrap">
                        {ahead > 0 && `↑${ahead}`}
                        {behind > 0 && `↓${behind}`}
                      </span>
                    </span>
                  )}
                  {repo.isLocal && (
                    <span className="flex items-center gap-1 shrink-0">
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    </span>
                  )}
                </>
              )}
            </div>

            {activityLabel && (
              <span className="text-xs text-muted-foreground/70 shrink-0">
                {activityLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}