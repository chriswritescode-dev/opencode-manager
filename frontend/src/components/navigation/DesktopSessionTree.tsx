import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { Repo } from '@/api/types'
import { Input } from '@/components/ui/input'
import { useNavigableRepos, useSidebarRepoGroups } from '@/hooks/useSidebarRepoGroups'
import {
  NewSessionButton,
  RepoNavGroup,
  RepoSessionNavList,
  SearchClearButton,
  SessionNavRow,
  SessionNavStatus,
} from '@/components/navigation/RepoSessionNav'
import { getActiveRepoId, isCurrentSessionItem } from '@/components/navigation/sidebar-session-tree'

function SessionSearchResults({ repos, search }: { repos: Repo[]; search: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const searchableRepos = useMemo(() => repos.filter((repo) => repo.cloneStatus === 'ready'), [repos])
  const { groups, isLoading, isError } = useSidebarRepoGroups({ repos: searchableRepos, search })
  const matchingGroups = groups.filter((group) => group.items.length > 0)

  if (isLoading) return <SessionNavStatus>Loading sessions...</SessionNavStatus>
  if (isError) return <SessionNavStatus>Failed to load sessions</SessionNavStatus>
  if (matchingGroups.length === 0) return <SessionNavStatus>No sessions found</SessionNavStatus>

  return (
    <>
      {matchingGroups.map((group) => (
        <RepoNavGroup
          key={group.repo.id}
          name={group.label}
          branch={group.branchLabel}
          isWorktree={group.repo.isWorktree}
          isOpen
          isCurrent={group.repo.id === getActiveRepoId(location.pathname)}
          onOpenRepo={() => navigate(`/repos/${group.repo.id}`)}
          actions={<NewSessionButton repo={group.repo} onOpenSession={navigate} />}
        >
          {group.items.map((item) => (
            <SessionNavRow
              key={item.key}
              item={item}
              isCurrent={isCurrentSessionItem(item, location.pathname)}
              onSelect={navigate}
            />
          ))}
        </RepoNavGroup>
      ))}
    </>
  )
}

export function DesktopSessionTree() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const { repos, isLoading } = useNavigableRepos()

  const clearSearch = () => {
    setSearchDraft('')
    setSearch('')
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setSearch(searchDraft.trim())
    } else if (event.key === 'Escape') {
      clearSearch()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search sessions"
            placeholder="Search sessions..."
            autoComplete="off"
            name="sidebar-session-search"
            className="h-8 pl-8 pr-9"
          />
          {(searchDraft.length > 0 || search.length > 0) && <SearchClearButton onClear={clearSearch} />}
        </div>
      </div>

      <div role="region" aria-label="Session navigator" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {isLoading ? (
          <SessionNavStatus>Loading repos...</SessionNavStatus>
        ) : search ? (
          <SessionSearchResults repos={repos} search={search} />
        ) : (
          <RepoSessionNavList
            repos={repos}
            activeRepoId={getActiveRepoId(location.pathname)}
            isVisible
            onOpenRepo={(repoId) => navigate(`/repos/${repoId}`)}
            onSelectSession={navigate}
            renderActions={(repo) => <NewSessionButton repo={repo} onOpenSession={navigate} />}
          />
        )}
      </div>
    </div>
  )
}
