import { useEffect, useRef } from 'react'
import { Command } from 'lucide-react'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

interface CommandSuggestionsProps {
  isOpen: boolean
  query: string
  commands: CommandType[]
  onSelect: (command: CommandType) => void
  onClose: () => void
  selectedIndex?: number
}

export function CommandSuggestions({
  isOpen,
  query,
  commands,
  onSelect,
  onClose,
  selectedIndex = 0
}: CommandSuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const filteredCommands = commands.filter(command =>
    command.name.toLowerCase().includes(query.toLowerCase())
  )

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

  if (!isOpen || filteredCommands.length === 0) {
    return null
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-background border border-border rounded-lg shadow-xl max-h-[30vh] md:max-h-[40vh] lg:max-h-[50vh] overflow-y-auto"
    >
      {filteredCommands.map((command, index) => {
        const isSelected = index === selectedIndex
        const displayName = `/${command.name}`

        return (
          <button
            key={command.name}
            onClick={() => onSelect(command)}
            className={`w-full px-3 py-2 text-left transition-colors flex items-center gap-2 ${
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-foreground'
            }`}
          >
            <Command className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'opacity-90' : 'opacity-70'}`} />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-medium truncate">{displayName}</div>
              {command.description && (
                <div className="text-xs opacity-70 mt-0.5 truncate">{command.description}</div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
