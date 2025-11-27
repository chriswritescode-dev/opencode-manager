import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitBranch, Check, Plus, GitCommit } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listBranches, switchBranch } from "@/api/repos";
import { useGitStatus } from "@/api/git";
import { AddBranchWorkspaceDialog } from "@/components/repo/AddBranchWorkspaceDialog";
import { GitChangesSheet } from "@/components/file-browser/GitChangesSheet";

interface BranchSwitcherProps {
  repoId: number;
  currentBranch: string;
  isWorktree?: boolean;
  repoUrl: string;
}

export function BranchSwitcher({ repoId, currentBranch, isWorktree, repoUrl }: BranchSwitcherProps) {
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [gitChangesOpen, setGitChangesOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: gitStatus } = useGitStatus(repoId);

  const { data: branches } = useQuery({
    queryKey: ["branches", repoId],
    queryFn: () => listBranches(repoId),
    enabled: !!repoId,
  });

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => switchBranch(repoId, branch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repo", repoId] });
      queryClient.invalidateQueries({ queryKey: ["branches", repoId] });
    },
  });

  if (isWorktree) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1 sm:px-2 text-[10px] sm:text-xs text-blue-400 hover:text-blue-300 hover:bg-accent gap-1 border border-blue-500/20"
          >
            <GitBranch className="w-3 h-3" />
            <span className="hidden sm:inline">{currentBranch}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-card border-border min-w-[200px]">
          {branches?.remote && branches.remote.length > 0 ? (
            branches.remote.map((branch: string) => (
              <DropdownMenuItem
                key={branch}
                onClick={() => switchBranchMutation.mutate(branch)}
                disabled={switchBranchMutation.isPending}
                className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <GitBranch className="w-3 h-3" />
                  <span className="flex-1">{branch}</span>
                  {branch === currentBranch && <Check className="w-3 h-3 text-green-500" />}
                </div>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled className="text-muted-foreground">
              Loading branches...
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
          {!isWorktree && (
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
        </DropdownMenuContent>
      </DropdownMenu>

      <AddBranchWorkspaceDialog
        open={addBranchOpen}
        onOpenChange={setAddBranchOpen}
        repoUrl={repoUrl}
      />

      <GitChangesSheet
        isOpen={gitChangesOpen}
        onClose={() => setGitChangesOpen(false)}
        repoId={repoId}
        currentBranch={currentBranch}
      />
    </>
  );
}