import { useEffect, useRef } from 'react'
import { Bot, FileText } from 'lucide-react'

export interface MentionItem {
  type: 'file' | 'agent'
  value: string
  label: string
  description?: string
}

interface MentionSuggestionsProps {
  isOpen: boolean
  items: MentionItem[]
  onSelect: (item: MentionItem) => void
  onClose: () => void
  selectedIndex?: number
}

export function MentionSuggestions({
  isOpen,
  items,
  onSelect,
  onClose,
  selectedIndex = 0
}: MentionSuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !listRef.current) return
    
    const selectedItem = listRef.current.children[selectedIndex] as HTMLElement
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isOpen])

  if (!isOpen || items.length === 0) return null

  const getFilename = (path: string) => path.split('/').pop() || path
  const getDirectory = (path: string) => {
    const parts = path.split('/')
    return parts.slice(0, -1).join('/') || '.'
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-background border border-border rounded-lg shadow-xl max-h-[30vh] md:max-h-[40vh] lg:max-h-[50vh] overflow-y-auto"
    >
      {items.map((item, idx) => (
        <button
          key={`${item.type}-${item.value}`}
          onClick={() => onSelect(item)}
          className={`w-full px-3 py-2 text-left transition-colors flex items-start gap-2 ${
            idx === selectedIndex
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          {item.type === 'agent' ? (
            <Bot className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm font-medium truncate">
              {item.type === 'file' ? getFilename(item.value) : item.label}
            </div>
            <div className="text-xs opacity-70 mt-0.5 truncate">
              {item.type === 'file' ? getDirectory(item.value) : item.description || 'Agent'}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
