import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useRefreshOnOpen } from '@/hooks/useRefreshOnOpen'
import { Input } from '@/components/ui/input'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { getRepoDisplayName } from '@/lib/utils'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { FolderGit2, Plus } from 'lucide-react'
import { useUrlParams } from '@/hooks/useUrlParams'
import { getAssistantPath } from '@/lib/navigation'
import { NewSessionButton, RepoSessionNavList, SearchClearButton } from '@/components/navigation/RepoSessionNav'
import { getActiveRepoId } from '@/components/navigation/sidebar-session-tree'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'

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
  const activeRepoId = getActiveRepoId(location.pathname)

  const { repos, isLoading, refetch } = useNavigableRepos(isOpen)

  useRefreshOnOpen(isOpen, refetch)

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return repos
    const query = searchQuery.toLowerCase()
    return repos.filter((repo) =>
      getRepoDisplayName(repo).toLowerCase().includes(query)
    )
  }, [repos, searchQuery])

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

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[70dvh]" ariaLabel="Switch repo">
        <BottomSheetHeader className="border-b-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="pr-9"
                autoComplete="off"
                name="repo-quick-switch"
              />
              {searchQuery.length > 0 && <SearchClearButton onClear={() => setSearchQuery('')} />}
            </div>
            <Button
              type="button"
              size="lg"
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
      <BottomSheetContent className="flex flex-col px-0 pt-0 gap-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 px-4 pt-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 pt-3 pb-12 text-muted-foreground">
            <FolderGit2 className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No repos found</p>
          </div>
        ) : (
          <RepoSessionNavList
            repos={filteredRepos}
            activeRepoId={activeRepoId}
            isVisible={isOpen}
            onOpenRepo={handleClick}
            onSelectSession={(path) => navigateAndClose(path)}
            renderActions={(repo) => <NewSessionButton repo={repo} onOpenSession={(path) => navigateAndClose(path)} />}
          />
        )}
        <div aria-hidden="true" className="h-16 shrink-0" />
      </BottomSheetContent>
      </BottomSheet>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </>
  )
}
