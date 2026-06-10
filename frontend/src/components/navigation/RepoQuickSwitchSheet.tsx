import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { cn, getRepoDisplayName } from '@/lib/utils'
import { listRepos } from '@/api/repos'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { FolderGit2, Check, Plus, House } from 'lucide-react'
import { useUrlParams } from '@/hooks/useUrlParams'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getAssistantPath, isAssistantPath } from '@/lib/navigation'

interface RepoQuickSwitchSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function RepoQuickSwitchSheet({ isOpen, onClose }: RepoQuickSwitchSheetProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { searchParams } = useUrlParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [addRepoOpen, setAddRepoOpen] = useState(false)

  const activeRepoId = useMemo(() => {
    if (isAssistantPath(location.pathname)) return null
    const match = location.pathname.match(/^\/repos\/(\d+)/)
    return match ? Number(match[1]) : null
  }, [location.pathname])

  const { data: repos, isLoading } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: isOpen,
  })

  const regularRepos = useMemo(
    () => repos?.filter((r) => r.id !== ASSISTANT_REPO_ID) ?? null,
    [repos],
  )

  const filteredRepos = useMemo(() => {
    if (!regularRepos) return []
    const sorted = [...regularRepos].sort((a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0))
    if (!searchQuery.trim()) return sorted
    const query = searchQuery.toLowerCase()
    return sorted.filter((repo) =>
      getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath).toLowerCase().includes(query)
    )
  }, [regularRepos, searchQuery])

  const isUrlControlledSheet = searchParams.get('mobileTab') === 'repos'

  const navigateAndClose = (path: string, options?: { replace?: boolean }) => {
    navigate(path, options)
    if (!isUrlControlledSheet) {
      onClose()
    }
  }

  const handleClick = (id: number) => {
    if (searchParams.get('mobileTabAction') === 'assistant') {
      navigateAndClose(getAssistantPath(), { replace: true })
      return
    }

    if (id === activeRepoId) {
      onClose()
      return
    }

    navigateAndClose(`/repos/${id}`, { replace: true })
  }

  const handleHomeClick = () => {
    navigateAndClose('/')
  }

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[70dvh]" ariaLabel="Switch repo">
        <BottomSheetHeader>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleHomeClick}
              className="flex-shrink-0"
            >
              <House className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
              <span className="sr-only">Home</span>
            </Button>
            <Input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="flex-1"
              autoComplete="off"
              name="repo-quick-switch"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose()
                setAddRepoOpen(true)
              }}
              className="flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Repo</span>
              <span className="sr-only">Add repository</span>
            </Button>
          </div>
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
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </>
  )
}
