import { useState, useCallback, useRef } from 'react'
import { WebTerminal } from './WebTerminal'
import { Button } from '@/components/ui/button'
import { Plus, Terminal as TerminalIcon, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TerminalTab {
  id: string
  name: string
}

interface TerminalPanelProps {
  cwd?: string
  isOpen: boolean
  onClose: () => void
  className?: string
}

export function TerminalPanel({ cwd, isOpen, onClose, className }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const tabCounter = useRef(0)
  const initializedRef = useRef(false)

  const addNewTab = useCallback(() => {
    tabCounter.current += 1
    const newTab: TerminalTab = {
      id: `terminal-${Date.now()}-${tabCounter.current}`,
      name: `Terminal ${tabCounter.current}`,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    setIsMinimized(false)
  }, [])

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

  if (!isOpen) return null

  if (!initializedRef.current && cwd) {
    initializedRef.current = true
    setTimeout(addNewTab, 0)
  }

  return (
    <div className={cn(
      'border-t border-border bg-[#0a0a0a] flex flex-col transition-all duration-200',
      isMinimized ? 'h-10' : 'h-[300px]',
      className
    )}>
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-900 border-b border-border shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors shrink-0',
                activeTabId === tab.id
                  ? 'bg-zinc-800 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50'
              )}
              onClick={() => {
                setActiveTabId(tab.id)
                setIsMinimized(false)
              }}
            >
              <TerminalIcon className="w-3 h-3" />
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
          <Button
            variant="ghost"
            size="sm"
            onClick={addNewTab}
            className="h-6 px-2 text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-muted-foreground hover:text-red-400 transition-colors"
            title="Close Terminal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 min-h-0">
          {tabs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Button variant="ghost" onClick={addNewTab} className="gap-2">
                <Plus className="w-4 h-4" />
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
                  cwd={cwd}
                  className="h-full rounded-none border-0"
                  showControls={false}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
