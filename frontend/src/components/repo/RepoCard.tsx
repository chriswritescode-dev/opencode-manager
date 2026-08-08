import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, GitBranch, FolderOpen, AlertCircle } from "lucide-react";
import { getRepoDisplayName } from "@/lib/utils";
import type { GitStatusResponse } from "@/types/git"
import { RepoRowActions } from "./RepoRowActions"

interface RepoCardProps {
  repo: {
    id: number;
    name?: string | null;
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
  selectionMode?: boolean;
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
  selectionMode = false,
}: RepoCardProps) {
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);

  const repoName = getRepoDisplayName(repo);
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch;
  const isReady = repo.cloneStatus === "ready";
  const isCloning = repo.cloneStatus === "cloning";

  const isDirty = gitStatus?.hasChanges || false;
  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const stagedCount = gitStatus?.files?.filter((f) => f.staged).length || 0;
  const unstagedCount = gitStatus?.files?.filter((f) => !f.staged).length || 0;

  const handleCardClick = () => {
    if (selectionMode && onSelect) {
      onSelect(repo.id, !isSelected);
      return;
    }
    if (isReady && !actionsOpen) {
      navigate(`/repos/${repo.id}`);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`relative border rounded-xl overflow-hidden transition-all duration-200 w-full ${
        isReady ? "cursor-pointer active:scale-[0.98] hover:border-primary/30 hover:bg-accent/50 hover:shadow-md" : "cursor-default"
      } ${
        isSelected
          ? "border-primary/40 bg-primary/6"
          : "border-border bg-card"
      }`}
    >
      <div className="p-1.5">
        <div>
          <div className="flex items-start gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h3 className="font-semibold text-base text-foreground truncate">
                {repoName}
              </h3>
              {isReady && (
                <div className={`w-2 h-2 rounded-full shrink-0 ${isDirty ? 'bg-warning' : 'bg-success'}`} />
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  Cloning...
                </span>
              ) : (
                <>
                  <span className={`flex items-center gap-1 shrink-0 ${repo.isWorktree ? 'text-info' : ''}`}>
                    <GitBranch className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[80px]">{branchToDisplay || "main"}</span>
                  </span>
                  {isDirty && (
                    <span className="flex items-center gap-1 text-warning shrink-0">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs whitespace-nowrap">
                        {unstagedCount > 0 && unstagedCount}
                        {unstagedCount > 0 && stagedCount > 0 && "/"}
                        {stagedCount > 0 && `${stagedCount}s`}
                      </span>
                    </span>
                  )}
                  {(ahead > 0 || behind > 0) && (
                    <span className="flex items-center gap-1 text-info shrink-0">
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