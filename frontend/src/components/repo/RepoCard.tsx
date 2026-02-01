import { useState } from "react";
import { Button } from "@/components/ui/button";

import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2, Download, GitBranch, FolderOpen, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { downloadRepo } from "@/api/repos";
import { showToast } from "@/lib/toast";
import type { GitStatusResponse } from "@/types/git";
import { SourceControlPanel } from "@/components/source-control/SourceControlPanel";
import { DownloadDialog } from "@/components/ui/download-dialog";

interface RepoCardProps {
  repo: {
    id: number;
    repoUrl?: string | null;
    localPath?: string;
    branch?: string;
    currentBranch?: string;
    cloneStatus: string;
    isWorktree?: boolean;
    isLocal?: boolean;
    fullPath?: string;
  };
  onDelete: (id: number) => void;
  isDeleting: boolean;
  isSelected?: boolean;
  onSelect?: (id: number, selected: boolean) => void;
  gitStatus?: GitStatusResponse;
}

export function RepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected = false,
  onSelect,
  gitStatus,
}: RepoCardProps) {
  const navigate = useNavigate();
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [showSourceControl, setShowSourceControl] = useState(false);

  const repoName = repo.repoUrl
    ? repo.repoUrl.split("/").slice(-1)[0].replace(".git", "")
    : repo.localPath || "Local Repo";
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch;
  const isReady = repo.cloneStatus === "ready";
  const isCloning = repo.cloneStatus === "cloning";

  const isDirty = gitStatus?.hasChanges || false;
  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const stagedCount = gitStatus?.files.filter((f) => f.staged).length || 0;
  const unstagedCount = gitStatus?.files.filter((f) => !f.staged).length || 0;

  const handleCardClick = () => {
    if (isReady && !showSourceControl && !showDownloadDialog) {
      navigate(`/repos/${repo.id}`);
    }
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const handleDownload = async (options: { includeGit?: boolean, includePaths?: string[] }) => {
    try {
      await downloadRepo(repo.id, repoName, options);
      showToast.success("Download complete");
    } catch (error: unknown) {
      showToast.error(error instanceof Error ? error.message : "Download failed");
    }
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
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelect(repo.id, checked === true)}
                  className="w-5 h-5"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base text-foreground truncate">
                {repoName}
              </h3>
              {isReady && (
                <div className={`w-2 h-2 rounded-full shrink-0 ${isDirty ? 'bg-orange-500' : 'bg-green-500'}`} />
              )}

            </div>
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

            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => handleActionClick(e, () => setShowSourceControl(true))}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title="Source Control"
              >
                <GitBranch className="w-4 h-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => handleActionClick(e, () => setShowDownloadDialog(true))}
                disabled={!isReady}
                className="h-8 w-8 p-0"
              >
                <Download className="w-4 h-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => handleActionClick(e, () => onDelete(repo.id))}
                disabled={isDeleting}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <SourceControlPanel
        repoId={repo.id}
        isOpen={showSourceControl}
        onClose={() => setShowSourceControl(false)}
        currentBranch={branchToDisplay || ""}
        repoUrl={repo.repoUrl}
        isRepoWorktree={repo.isWorktree}
        repoName={repoName}
      />
      <DownloadDialog
        open={showDownloadDialog}
        onOpenChange={setShowDownloadDialog}
        onDownload={handleDownload}
        title="Download Repository"
        description="This will create a ZIP archive of the entire repository."
        itemName={repoName}
        targetPath={repo.fullPath}
      />
    </div>
  );
}
