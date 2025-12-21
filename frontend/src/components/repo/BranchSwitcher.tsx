import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitBranch, Check, Plus, GitCommit, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listBranches, switchBranch, GitAuthError } from "@/api/repos";
import { useGitStatus } from "@/api/git";
import { AddBranchWorkspaceDialog } from "@/components/repo/AddBranchWorkspaceDialog";
import { GitChangesSheet } from "@/components/file-browser/GitChangesSheet";
import { showToast } from "@/lib/toast";

interface BranchSwitcherProps {
  repoId: number;
  currentBranch: string;
  isWorktree?: boolean;
  repoUrl?: string | null;
  repoLocalPath?: string;
  className?: string;
  iconOnly?: boolean;
}

export function BranchSwitcher({ repoId, currentBranch, isWorktree, repoUrl, repoLocalPath, className, iconOnly }: BranchSwitcherProps) {
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [gitChangesOpen, setGitChangesOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: gitStatus } = useGitStatus(repoId);

  const { data: branches, isLoading: branchesLoading, refetch: refetchBranches } = useQuery({
    queryKey: ["branches", repoId],
    queryFn: () => listBranches(repoId),
    enabled: !!repoId,
    staleTime: 1000 * 30,
  });

  const activeBranch = branches?.current ?? currentBranch;

  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (open && repoId) {
      refetchBranches();
    }
  }, [repoId, refetchBranches]);

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => switchBranch(repoId, branch),
    onSuccess: async (updatedRepo) => {
      queryClient.setQueryData(["repo", repoId], updatedRepo);
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      await refetchBranches();
      showToast.success(`Switched to branch: ${updatedRepo.currentBranch}`);
    },
    onError: (error) => {
      if (error instanceof GitAuthError) {
        showToast.error('Authentication failed. Please update your Git token in Settings or run "gh auth login".');
      } else {
        showToast.error(error.message || 'Failed to switch branch');
      }
    },
  });

  const showLoading = switchBranchMutation.isPending || branchesLoading;

  return (
    <>
      <DropdownMenu onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={switchBranchMutation.isPending}
            className={`h-6 px-1 sm:px-2 text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent gap-1 border border-blue-500/20 ${iconOnly ? 'w-6' : ''} ${className || ""}`}
          >
            {showLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <GitBranch className="w-3 h-3" />
            )}
            {!iconOnly && <span className="truncate">{activeBranch}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={0} align="end" className="bg-card border-border min-w-[200px]">
          {isWorktree ? (
            <>
              <DropdownMenuItem disabled className="text-muted-foreground">
                <div className="flex items-center gap-2 w-full">
                  <GitBranch className="w-3 h-3" />
                  <span className="flex-1">Worktree: {activeBranch}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setGitChangesOpen(true)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <GitCommit className="w-3 h-3" />
                  <span className="flex-1">View Changes</span>
                  {gitStatus?.hasChanges && (
                    <span className="text-xs text-yellow-500">
                      {gitStatus.files.length}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {branchesLoading ? (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  Loading branches...
                </DropdownMenuItem>
              ) : branches?.all && branches.all.length > 0 ? (
                branches.all.map((branch: string) => (
                  <DropdownMenuItem
                    key={branch}
                    onClick={() => switchBranchMutation.mutate(branch)}
                    disabled={switchBranchMutation.isPending}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <GitBranch className="w-3 h-3" />
                      <span className="flex-1">{branch}</span>
                      {branch === activeBranch && <Check className="w-3 h-3 text-green-500" />}
                    </div>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  No branches available
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setGitChangesOpen(true)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <GitCommit className="w-3 h-3" />
                  <span className="flex-1">View Changes</span>
                  {gitStatus?.hasChanges && (
                    <span className="text-xs text-yellow-500">
                      {gitStatus.files.length}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
              {repoUrl && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setAddBranchOpen(true)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Plus className="w-3 h-3" />
                      <span className="flex-1">Add Branch</span>
                    </div>
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {repoUrl && (
        <AddBranchWorkspaceDialog
          open={addBranchOpen}
          onOpenChange={setAddBranchOpen}
          repoUrl={repoUrl}
          repoId={repoId}
        />
      )}

      <GitChangesSheet
        isOpen={gitChangesOpen}
        onClose={() => setGitChangesOpen(false)}
        repoId={repoId}
        currentBranch={activeBranch}
        repoLocalPath={repoLocalPath}
      />
    </>
  );
}
