import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useRecentSessions, type RecentSession } from '@/hooks/useRecentSessions'
import { useSessionSwitcherStore } from '@/stores/sessionSwitcherStore'
import { Clock, FolderGit2, Activity, Circle, Search, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

function SessionStatusIcon({ status }: { status?: 'idle' | 'busy' | 'retry' }) {
  if (status === 'busy') {
    return <Activity className="w-3 h-3 text-blue-500 animate-pulse" />
  }
  if (status === 'retry') {
    return <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
  }
  return <Circle className="w-2 h-2 text-muted-foreground fill-current" />
}

export function SessionSwitcher() {
  const navigate = useNavigate()
  const isOpen = useSessionSwitcherStore((state) => state.isOpen)
  const close = useSessionSwitcherStore((state) => state.close)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useRecentSessions(8)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        useSessionSwitcherStore.getState().toggle()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  const filteredSessions = useMemo(() => {
    if (!data?.sessions) return []
    if (!search.trim()) return data.sessions

    const query = search.toLowerCase()
    return data.sessions.filter((session) => {
      const titleMatch = session.title.toLowerCase().includes(query)
      const repoMatch = session.repoName?.toLowerCase().includes(query)
      return titleMatch || repoMatch
    })
  }, [data?.sessions, search])

  const handleSelect = (session: RecentSession) => {
    if (session.repoId) {
      navigate(`/repos/${session.repoId}/sessions/${session.id}`)
    }
    close()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden" hideCloseButton aria-describedby={undefined}>
        <h2 className="sr-only">Quick Session Switcher</h2>
        <Command
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          shouldFilter={false}
        >
          <div className="flex items-center border-b px-3">
            <Search className="w-4 h-4 shrink-0 opacity-50 mr-2" />
            <Command.Input
              placeholder="Search sessions..."
              value={search}
              onValueChange={setSearch}
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-2">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {isLoading && (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading sessions...
              </div>
            )}
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No sessions found.
            </Command.Empty>
            <Command.Group heading="Recent Sessions (Last 8 hours)">
              {filteredSessions.map((session) => (
                <Command.Item
                  key={session.id}
                  value={session.id}
                  onSelect={() => handleSelect(session)}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none",
                    "aria-selected:bg-accent aria-selected:text-accent-foreground",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <SessionStatusIcon status={session.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{session.title}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {session.repoName && (
                          <span className="flex items-center gap-1">
                            <FolderGit2 className="w-3 h-3" />
                            <span className="truncate max-w-[120px]">{session.repoName}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(session.time.updated), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="border-t p-2 text-xs text-muted-foreground flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted">↵</kbd>
                Select
              </span>
            </div>
            <span>{filteredSessions.length} sessions</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
