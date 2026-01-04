import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listRepos, deleteRepo } from "@/api/repos";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Loader2, GitBranch, Search } from "lucide-react";
import { RepoCard } from "./RepoCard";

export function RepoList() {
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [repoToDelete, setRepoToDelete] = useState<number | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: repos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repos"],
    queryFn: listRepos,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      setDeleteDialogOpen(false);
      setRepoToDelete(null);
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (repoIds: number[]) => {
      await Promise.all(repoIds.map((id) => deleteRepo(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      setDeleteDialogOpen(false);
      setSelectedRepos(new Set());
    },
  });

  if (isLoading && !repos) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center p-8 text-destructive">
        Failed to load repositories:{" "}
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!repos || repos.length === 0) {
    return (
      <div className="text-center p-12">
        <GitBranch className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
        <p className="text-zinc-500">
          No repositories yet. Add one to get started.
        </p>
      </div>
    );
  }

  const dedupedRepos = repos.reduce((acc, repo) => {
    if (repo.isWorktree) {
      acc.push(repo);
    } else {
      const key = repo.repoUrl || repo.localPath;
      const existing = acc.find(r => (r.repoUrl || r.localPath) === key && !r.isWorktree);
      
      if (!existing) {
        acc.push(repo);
      }
    }
    
    return acc;
  }, [] as typeof repos);

  const filteredRepos = dedupedRepos.filter((repo) => {
    const repoName = repo.repoUrl 
      ? repo.repoUrl.split("/").slice(-1)[0].replace(".git", "")
      : repo.localPath;
    const searchTarget = repo.repoUrl || repo.localPath || "";
    return (
      repoName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      searchTarget.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const handleSelectRepo = (id: number, selected: boolean) => {
    const newSelected = new Set(selectedRepos);
    if (selected) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedRepos(newSelected);
  };

  const handleSelectAll = () => {
    const allFilteredSelected = filteredRepos.every((repo) =>
      selectedRepos.has(repo.id),
    );

    if (allFilteredSelected) {
      setSelectedRepos(new Set());
    } else {
      const filteredIds = filteredRepos.map((repo) => repo.id);
      setSelectedRepos(new Set([...selectedRepos, ...filteredIds]));
    }
  };

  const handleBatchDelete = () => {
    if (selectedRepos.size > 0) {
      setDeleteDialogOpen(true);
    }
  };

  const handleDeleteAll = () => {
    if (filteredRepos.length === 0) return;
    setSelectedRepos(new Set(filteredRepos.map((r) => r.id)));
    setDeleteDialogOpen(true);
  };


  return (
    <>
      <div className="px-0 md:p-4 h-full flex flex-col">
        <div className="mb-4 md:mb-6 px-2 md:px-0">
          <ListToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCount={selectedRepos.size}
            totalCount={filteredRepos.length}
            allSelected={
              filteredRepos.length > 0 &&
              filteredRepos.every((repo) => selectedRepos.has(repo.id))
            }
            onToggleSelectAll={handleSelectAll}
            onDelete={handleBatchDelete}
            onDeleteAll={handleDeleteAll}
          />
        </div>

        <div className="mx-2 md:mx-0 flex-1 min-h-0">
          <div className="h-full overflow-y-auto py-2 md:py-0">
            {filteredRepos.length === 0 ? (
              <div className="text-center p-12">
                <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                <p className="text-zinc-500">
                  No repositories found matching "{searchQuery}"
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full pb-20 md:pb-0">
                {filteredRepos.map((repo) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    onDelete={(id) => {
                      setRepoToDelete(id);
                      setDeleteDialogOpen(true);
                    }}
                    isDeleting={
                      deleteMutation.isPending && repoToDelete === repo.id
                    }
                    isSelected={selectedRepos.has(repo.id)}
                    onSelect={handleSelectRepo}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => {
          if (repoToDelete) {
            deleteMutation.mutate(repoToDelete);
          } else if (selectedRepos.size > 0) {
            batchDeleteMutation.mutate(Array.from(selectedRepos));
          }
        }}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setRepoToDelete(null);
          setSelectedRepos(new Set());
        }}
        title={
          selectedRepos.size > 0
            ? "Delete Multiple Repositories"
            : "Delete Repository"
        }
        description={
          selectedRepos.size > 0
            ? `Are you sure you want to delete ${selectedRepos.size} repositor${selectedRepos.size === 1 ? "y" : "ies"}? This will remove all local files. This action cannot be undone.`
            : "Are you sure you want to delete this repository? This will remove all local files. This action cannot be undone."
        }
        isDeleting={deleteMutation.isPending || batchDeleteMutation.isPending}
      />
    </>
  );
}
