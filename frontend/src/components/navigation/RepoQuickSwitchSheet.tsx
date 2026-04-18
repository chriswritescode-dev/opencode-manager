import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { getRepoDisplayName } from '@/lib/utils'
import { listRepos } from '@/api/repos'

interface RepoQuickSwitchSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function RepoQuickSwitchSheet({ isOpen, onClose }: RepoQuickSwitchSheetProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  const { data: repos, isLoading } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: isOpen,
  })

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    if (!searchQuery.trim()) return repos
    const query = searchQuery.toLowerCase()
    return repos.filter((repo) => {
      const displayName = getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath).toLowerCase()
      return displayName.includes(query)
    })
  }, [repos, searchQuery])

  const handleClick = (id: number) => {
    navigate(`/repos/${id}`)
    onClose()
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[70dvh]" ariaLabel="Switch repo">
      <BottomSheetHeader title="Switch repo" />
      <BottomSheetContent className="flex flex-col gap-3">
        <Input
          type="text"
          placeholder="Search repos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-lg bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No repos found
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredRepos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                onClick={() => handleClick(repo.id)}
                className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
              >
                <span className="font-medium text-foreground truncate w-full">
                  {getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath)}
                </span>
                {repo.currentBranch && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {repo.currentBranch}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </BottomSheetContent>
    </BottomSheet>
  )
}
