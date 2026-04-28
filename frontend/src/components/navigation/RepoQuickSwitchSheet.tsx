import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { cn, getRepoDisplayName } from '@/lib/utils'
import { listRepos } from '@/api/repos'
import { FolderGit2, Check } from 'lucide-react'

interface RepoQuickSwitchSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function RepoQuickSwitchSheet({ isOpen, onClose }: RepoQuickSwitchSheetProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchQuery, setSearchQuery] = useState('')

  const activeRepoId = useMemo(() => {
    const match = location.pathname.match(/^\/repos\/(\d+)/)
    return match ? Number(match[1]) : null
  }, [location.pathname])

  const { data: repos, isLoading } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: isOpen,
  })

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    const sorted = [...repos].sort((a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0))
    if (!searchQuery.trim()) return sorted
    const query = searchQuery.toLowerCase()
    return sorted.filter((repo) =>
      getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath).toLowerCase().includes(query)
    )
  }, [repos, searchQuery])

  const handleClick = (id: number) => {
    const pendingAction = new URLSearchParams(location.search).get('mobileTabAction')
    if (pendingAction === 'assistant') {
      navigate(`/repos/${id}/assistant`)
      onClose()
      return
    }

    const isAssistantRoute = location.pathname === `/repos/${id}/assistant`
    if (id === activeRepoId) {
      if (isAssistantRoute) {
        navigate(`/repos/${id}`, { replace: true })
        return
      }

      onClose()
      return
    }

    navigate(`/repos/${id}`, { replace: true })
    onClose()
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[70dvh]" ariaLabel="Switch repo">
      <BottomSheetHeader>
        <Input
          type="text"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          className="flex-shrink-0"
        />
      </BottomSheetHeader>
      <BottomSheetContent className="flex flex-col gap-2 overflow-y-auto pt-2">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderGit2 className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No repos found</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredRepos.map((repo) => {
              const isActive = repo.id === activeRepoId
              return (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleClick(repo.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex items-center gap-3 p-3 rounded-lg border transition-all text-left w-full',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-accent hover:bg-accent/50',
                  )}
                >
                  <div className="flex-shrink-0">
                    <div
                      className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-md',
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
                      )}
                    >
                      <FolderGit2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 font-medium text-sm text-foreground truncate">
                    {getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath)}
                  </div>
                  {isActive && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </BottomSheetContent>
    </BottomSheet>
  )
}
