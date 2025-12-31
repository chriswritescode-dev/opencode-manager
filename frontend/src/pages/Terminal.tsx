import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { WebTerminal } from '@/components/terminal/WebTerminal'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, Terminal as TerminalIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TerminalTab {
  id: string
  name: string
}

export function TerminalPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = parseInt(id || '0')
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabCounter = useRef(0)
  const initializedRef = useRef(false)

  const { data: repo, isLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  })

  const addNewTab = useCallback(() => {
    tabCounter.current += 1
    const newTab: TerminalTab = {
      id: `terminal-${Date.now()}-${tabCounter.current}`,
      name: `Terminal ${tabCounter.current}`,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [])

  useEffect(() => {
    if (!initializedRef.current && repo?.fullPath) {
      initializedRef.current = true
      addNewTab()
    }
  }, [repo?.fullPath, addNewTab])

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId)
      if (activeTabId === tabId && newTabs.length > 0) {
        const closedIndex = prev.findIndex(t => t.id === tabId)
        const newActiveIndex = Math.min(closedIndex, newTabs.length - 1)
        setActiveTabId(newTabs[newActiveIndex].id)
      } else if (newTabs.length === 0) {
        setActiveTabId(null)
      }
      return newTabs
    })
  }, [activeTabId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">Repository not found</p>
      </div>
    )
  }

  const repoName = repo.repoUrl
    ? repo.repoUrl.split('/').pop()?.replace('.git', '') || 'Repository'
    : repo.localPath || 'Local Repository'

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/repos/${repoId}`)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">{repoName}</h1>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={addNewTab}>
          <Plus className="w-4 h-4 mr-1" />
          New Terminal
        </Button>
      </header>

      {tabs.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-900 border-b border-border overflow-x-auto shrink-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-2 px-3 py-1.5 rounded-t text-sm cursor-pointer transition-colors',
                activeTabId === tab.id
                  ? 'bg-[#0a0a0a] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800'
              )}
              onClick={() => setActiveTabId(tab.id)}
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              <span>{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-700 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 p-2">
        {tabs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <TerminalIcon className="w-12 h-12 mb-4 opacity-50" />
            <p className="mb-4">No terminals open</p>
            <Button onClick={addNewTab}>
              <Plus className="w-4 h-4 mr-2" />
              Open Terminal
            </Button>
          </div>
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'h-full',
                activeTabId === tab.id ? 'block' : 'hidden'
              )}
            >
              <WebTerminal
                sessionId={tab.id}
                cwd={repo.fullPath}
                className="h-full"
                showControls={false}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
