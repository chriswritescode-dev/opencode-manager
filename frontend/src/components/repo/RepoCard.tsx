import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, GitBranch, FolderOpen, AlertCircle } from "lucide-react";
import { getRepoDisplayName } from "@/lib/utils";
import type { Repo } from "@/api/types";
import type { GitStatusResponse } from "@/types/git"
import { RepoActivityIndicator } from "@/components/activity/RepoActivityIndicator"
import { RepoCardShell } from "./RepoCardShell"
import { RepoRowActions } from "./RepoRowActions"

interface RepoCardProps {
  repo: Repo;
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

  const meta = isCloning ? (
    <span className="flex items-center gap-1.5">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
      Cloning...
    </span>
  ) : (
    <>
      <span className={`flex items-center gap-1 shrink-0 ${repo.isWorktree ? 'text-primary' : ''}`}>
        <GitBranch className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[80px]">{branchToDisplay || "main"}</span>
      </span>
      {isDirty && (
        <span className="flex items-center gap-1 text-highlight shrink-0">
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
  );

  return (
    <RepoCardShell
      title={repoName}
      statusDotClassName={isReady ? (isDirty ? 'bg-highlight' : 'bg-success') : undefined}
      activity={<RepoActivityIndicator repo={repo} />}
      actions={
        !manageMode && !isSelected && !hasSelectedRepos ? (
          <RepoRowActions
            repo={repo}
            gitStatus={gitStatus}
            onDelete={onDelete}
            isDeleting={isDeleting}
            isMobile={isMobile}
            onActionsOpenChange={setActionsOpen}
          />
        ) : undefined
      }
      meta={meta}
      activityLabel={activityLabel}
      isInteractive={isReady}
      isSelected={isSelected}
      onClick={handleCardClick}
    />
  );
}
