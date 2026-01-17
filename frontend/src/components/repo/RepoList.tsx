import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { listRepos, deleteRepo, updateRepoOrder } from "@/api/repos"
import { fetchReposGitStatus } from "@/api/git"
import { DeleteDialog } from "@/components/ui/delete-dialog"
import { ListToolbar } from "@/components/ui/list-toolbar"
import { GitBranch, Search, GripVertical } from "lucide-react"
import type { Repo } from "@/api/types"
import type { GitStatusResponse } from "@/types/git"
import { RepoCard } from "./RepoCard"
import { RepoCardSkeleton } from "./RepoCardSkeleton"

function SortableRepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected,
  onSelect,
  gitStatus,
}: {
  repo: Repo
  onDelete: (id: number) => void
  isDeleting: boolean
  isSelected: boolean
  onSelect: (id: number, selected: boolean) => void
  gitStatus?: GitStatusResponse
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: repo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div {...attributes} className="relative">
        <div {...listeners} className="absolute left-0 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-accent/80">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="pl-8">
          <RepoCard
            repo={repo}
            onDelete={onDelete}
            isDeleting={isDeleting}
            isSelected={isSelected}
            onSelect={onSelect}
            gitStatus={gitStatus}
          />
        </div>
      </div>
    </div>
  )
}

export function RepoList() {
  const queryClient = useQueryClient()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [repoToDelete, setRepoToDelete] = useState<number | null>(null)
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")

  const {
    data: repos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repos"],
    queryFn: listRepos,
  })

  const repoIds = repos?.map((repo) => repo.id) || []

  const { data: gitStatuses } = useQuery({
    queryKey: ["reposGitStatus", repoIds],
    queryFn: () => fetchReposGitStatus(repoIds),
    enabled: repoIds.length > 0,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] })
      setDeleteDialogOpen(false)
      setRepoToDelete(null)
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: async (repoIds: number[]) => {
      await Promise.all(repoIds.map((id) => deleteRepo(id)))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] })
      setDeleteDialogOpen(false)
      setSelectedRepos(new Set())
    },
  })

  const updateOrderMutation = useMutation({
    mutationFn: updateRepoOrder,
    onMutate: async (newOrder) => {
      await queryClient.cancelQueries({ queryKey: ["repos"] })

      const previousRepos = queryClient.getQueryData<Repo[]>(["repos"])

      queryClient.setQueryData<Repo[]>(["repos"], (old) => {
        if (!old) return old
        const repoMap = new Map(old.map((repo) => [repo.id, repo]))
        const reorderedRepos = newOrder.map((id) => repoMap.get(id)).filter((repo): repo is Repo => repo !== undefined)
        const newRepos = old.filter((repo) => !newOrder.includes(repo.id))
        return [...reorderedRepos, ...newRepos]
      })

      return { previousRepos }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["repos"], context?.previousRepos)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] })
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!repos || !over) return

    if (active.id !== over.id) {
      const oldIndex = repos.findIndex((repo) => repo.id === Number(active.id))
      const newIndex = repos.findIndex((repo) => repo.id === Number(over.id))

      if (oldIndex === -1 || newIndex === -1) return

      const newOrder = arrayMove(repos, oldIndex, newIndex).map((repo) => repo.id)
      updateOrderMutation.mutate(newOrder)
    }
  }

  if (isLoading && !repos) {
    return (
      <div className="px-0 md:p-4 h-full flex flex-col">
        <div className="px-2 md:px-0">
          <div className="h-10 bg-muted/50 animate-pulse rounded w-full" />
        </div>
        <div className="mx-2 md:mx-0 flex-1 min-h-0">
          <div className="h-full overflow-y-auto pt-4 pb-2 md:pb-0">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="pl-8">
                  <RepoCardSkeleton />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center p-8 text-destructive">
        Failed to load repositories:{" "}
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    )
  }

  if (!repos || repos.length === 0) {
    return (
      <div className="text-center p-12">
        <GitBranch className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
        <p className="text-zinc-500">
          No repositories yet. Add one to get started.
        </p>
      </div>
    )
  }

  const dedupedRepos = repos.reduce((acc, repo) => {
    if (repo.isWorktree) {
      acc.push(repo)
    } else {
      const key = repo.repoUrl || repo.localPath
      const existing = acc.find((r) => (r.repoUrl || r.localPath) === key && !r.isWorktree)

      if (!existing) {
        acc.push(repo)
      }
    }

    return acc
  }, [] as Repo[])

  const filteredRepos = dedupedRepos.filter((repo) => {
    const repoName = repo.repoUrl
      ? repo.repoUrl.split("/").slice(-1)[0].replace(".git", "")
      : repo.localPath
    const searchTarget = repo.repoUrl || repo.localPath || ""
    return (
      repoName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      searchTarget.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })

  const handleSelectRepo = (id: number, selected: boolean) => {
    const newSelected = new Set(selectedRepos)
    if (selected) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedRepos(newSelected)
  }

  const handleSelectAll = () => {
    const allFilteredSelected = filteredRepos.every((repo) =>
      selectedRepos.has(repo.id),
    )

    if (allFilteredSelected) {
      setSelectedRepos(new Set())
    } else {
      const filteredIds = filteredRepos.map((repo) => repo.id)
      setSelectedRepos(new Set([...selectedRepos, ...filteredIds]))
    }
  }

  const handleBatchDelete = () => {
    if (selectedRepos.size > 0) {
      setDeleteDialogOpen(true)
    }
  }

  const handleDeleteAll = () => {
    if (filteredRepos.length === 0) return
    setSelectedRepos(new Set(filteredRepos.map((r) => r.id)))
    setDeleteDialogOpen(true)
  }

  return (
    <>
      <div className="px-0 md:p-4 h-full flex flex-col">
        <div className=" px-2 md:px-0">
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
          <div className="h-full overflow-y-auto pt-4 pb-2 md:pb-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            {filteredRepos.length === 0 ? (
              <div className="text-center p-12">
                <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                <p className="text-zinc-500">
                  No repositories found matching "{searchQuery}"
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={filteredRepos.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full  md:pb-0">
                    {filteredRepos.map((repo) => (
                      <SortableRepoCard
                        key={repo.id}
                        repo={repo}
                        onDelete={(id) => {
                          setRepoToDelete(id)
                          setDeleteDialogOpen(true)
                        }}
                        isDeleting={
                          deleteMutation.isPending && repoToDelete === repo.id
                        }
                        isSelected={selectedRepos.has(repo.id)}
                        onSelect={handleSelectRepo}
                        gitStatus={gitStatuses?.get(repo.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      </div>

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => {
          if (repoToDelete) {
            deleteMutation.mutate(repoToDelete)
          } else if (selectedRepos.size > 0) {
            batchDeleteMutation.mutate(Array.from(selectedRepos))
          }
        }}
        onCancel={() => {
          setDeleteDialogOpen(false)
          setRepoToDelete(null)
          setSelectedRepos(new Set())
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
  )
}
