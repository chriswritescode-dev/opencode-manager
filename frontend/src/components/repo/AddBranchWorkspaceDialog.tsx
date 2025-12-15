import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRepo, createBranch } from "@/api/repos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface AddBranchWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoUrl: string;
  repoId: number;
}

export function AddBranchWorkspaceDialog({
  open,
  onOpenChange,
  repoUrl,
  repoId,
}: AddBranchWorkspaceDialogProps) {
  const [branch, setBranch] = useState("");
  const [useWorktree, setUseWorktree] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      if (useWorktree) {
        return createRepo(repoUrl, undefined, branch || undefined, undefined, true)
      }
      return createBranch(repoId, branch)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      queryClient.invalidateQueries({ queryKey: ["branches", repoId] });
      queryClient.invalidateQueries({ queryKey: ["repo", repoId] });
      setBranch("");
      setUseWorktree(false);
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (branch.trim()) {
      mutation.mutate();
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setUseWorktree(e.target.checked);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-[500px] bg-[#141414] border-[#2a2a2a]">
        <DialogHeader>
          <DialogTitle className="text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            Add Branch
          </DialogTitle>
          <p className="text-sm text-zinc-400 mt-1">
            Create a new branch for{" "}
            {repoUrl.split("/").pop()?.replace(".git", "")}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Branch *</label>
            <Input
              placeholder="feature-branch, main, etc."
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending}
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="worktree-checkbox"
                checked={useWorktree}
                onChange={handleCheckboxChange}
                disabled={mutation.isPending}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-600 focus:ring-2 cursor-pointer accent-blue-600"
                onClick={(e) => e.stopPropagation()}
              />
              <label
                htmlFor="worktree-checkbox"
                className="text-sm text-zinc-400 cursor-pointer select-none"
                onClick={(e) => {
                  e.preventDefault();
                  if (!mutation.isPending) {
                    setUseWorktree(!useWorktree);
                  }
                }}
              >
                Create as worktree
              </label>
            </div>
            <p className="text-xs text-zinc-500">
              {useWorktree
                ? "Creates a separate workspace directory - allows working on multiple branches simultaneously"
                : "Creates a local branch in the current repository"}
            </p>
          </div>

          <Button
            type="submit"
            disabled={!branch || mutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {useWorktree ? "Creating worktree..." : "Creating branch..."}
              </>
            ) : useWorktree ? (
              "Create Worktree"
            ) : (
              "Create Branch"
            )}
          </Button>
          {mutation.isError && (
            <p className="text-sm text-red-400">{mutation.error.message}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
