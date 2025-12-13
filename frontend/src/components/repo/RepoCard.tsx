import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2, ExternalLink, Download } from "lucide-react";
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

  return (
    <div
      className={`group relative bg-gradient-to-br from-card to-card-hover border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg w-full ${
        isSelected
          ? "border-blue-500 shadow-lg shadow-blue-900/30"
          : "border-border hover:border-border hover:shadow-blue-900/20"
      }`}
    >
      <div className="p-2 sm:p-6">
         <div className="mb-4">
           <div className="flex items-center gap-2 mb-2">
{onSelect && (
                <Checkbox
                  id="select-repo"
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    onSelect(repo.id, checked === true);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-5 h-5"
                />
              )}
<h3 
                 onClick={(e) => {
                   e.stopPropagation();
                   if (onSelect) {
                     onSelect(repo.id, !isSelected);
                   }
                 }}
                 className={`font-semibold text-lg text-foreground truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors ${
                   onSelect ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                 }`}
               >
                 {repoName}
               </h3>
             {repo.isWorktree && (
              <Badge
                className="text-xs px-2.5 py-0.5 bg-purple-600/20 text-purple-600 dark:text-purple-400 border-purple-600/40"
              >
                worktree
              </Badge>
            )}
            {repo.cloneStatus === "cloning" && (
              <Badge
                className="text-xs px-2.5 py-0.5 bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-600/40"
              >
                cloning
              </Badge>
            )}
          </div>
          
        </div>

        

        <div className="flex flex-col gap-2">
          {repo.cloneStatus === "cloning" && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
              <span>Cloning repository...</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/repos/${repo.id}`);
              }}
              disabled={!isReady}
              className="cursor-pointer flex-1 h-10 sm:h-9 px-3"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open
            </Button>

            {!repo.isWorktree && (
              <BranchSwitcher
                repoId={repo.id}
                currentBranch={branchToDisplay || ""}
                isWorktree={repo.isWorktree}
                repoUrl={repo.repoUrl}
                repoLocalPath={repo.localPath}
                iconOnly={true}
                className="h-10 sm:h-9 w-10"
              />
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={async (e) => {
                e.stopPropagation();
                setIsDownloading(true);
                try {
                  await downloadRepo(repo.id, repoName);
                  showToast.success("Download complete");
                } catch (error: unknown) {
                  showToast.error(error instanceof Error ? error.message : "Download failed");
                } finally {
                  setIsDownloading(false);
                }
              }}
              disabled={!isReady || isDownloading}
              className="h-10 sm:h-9 w-10 p-0"
              title="Download as ZIP (excludes gitignored files)"
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(repo.id);
              }}
              disabled={isDeleting}
              className="h-10 sm:h-9 w-10 p-0"
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
