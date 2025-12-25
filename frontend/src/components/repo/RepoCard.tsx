import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2, Download, GitBranch, FolderOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { downloadRepo } from "@/api/repos";
import { showToast } from "@/lib/toast";

import { BranchSwitcher } from "./BranchSwitcher";

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
  };
  onDelete: (id: number) => void;
  isDeleting: boolean;
  isSelected?: boolean;
  onSelect?: (id: number, selected: boolean) => void;
}

export function RepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected = false,
  onSelect,
}: RepoCardProps) {
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState(false);
  
  const repoName = repo.repoUrl 
    ? repo.repoUrl.split("/").slice(-1)[0].replace(".git", "")
    : repo.localPath || "Local Repo";
  const branchToDisplay = repo.currentBranch || repo.branch;
  const isReady = repo.cloneStatus === "ready";
  const isCloning = repo.cloneStatus === "cloning";

  const handleCardClick = () => {
    if (isReady) {
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
      <div className="p-4">
        <div className="flex items-start gap-3">
          {onSelect && (
            <div 
              className="pt-0.5"
              onClick={(e) => handleActionClick(e, () => onSelect(repo.id, !isSelected))}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => onSelect(repo.id, checked === true)}
                className="w-5 h-5"
              />
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base text-foreground truncate">
                {repoName}
              </h3>
              {repo.isWorktree && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                  worktree
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {isCloning ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  Cloning...
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3.5 h-3.5" />
                    {branchToDisplay || "main"}
                  </span>
                  {repo.isLocal && (
                    <span className="flex items-center gap-1">
                      <FolderOpen className="w-3.5 h-3.5" />
                      Local
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <BranchSwitcher
              repoId={repo.id}
              currentBranch={branchToDisplay || ""}
              isWorktree={repo.isWorktree}
              repoUrl={repo.repoUrl}
              repoLocalPath={repo.localPath}
              iconOnly={true}
              className="h-8 w-8"
            />

            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => handleActionClick(e, async () => {
                setIsDownloading(true);
                try {
                  await downloadRepo(repo.id, repoName);
                  showToast.success("Download complete");
                } catch (error: unknown) {
                  showToast.error(error instanceof Error ? error.message : "Download failed");
                } finally {
                  setIsDownloading(false);
                }
              })}
              disabled={!isReady || isDownloading}
              className="h-8 w-8 p-0"
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
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
  );
}
