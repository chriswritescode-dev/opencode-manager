import { useEffect, useRef } from 'react'

interface FileSuggestionsProps {
  isOpen: boolean
  files: string[]
  onSelect: (file: string) => void
  onClose: () => void
  selectedIndex?: number
}

export function FileSuggestions({
  isOpen,
  files,
  onSelect,
  onClose,
  selectedIndex = 0
}: FileSuggestionsProps) {
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

  if (!isOpen || files.length === 0) return null

  const getFilename = (path: string) => path.split('/').pop() || path
  const getDirectory = (path: string) => {
    const parts = path.split('/')
    return parts.slice(0, -1).join('/') || '.'
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-background border border-border rounded-lg shadow-xl max-h-48 md:max-h-[40vh] lg:max-h-[50vh] overflow-y-auto"
    >
      {files.map((file, idx) => (
        <button
          key={file}
          onMouseDown={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            e.preventDefault()
            onSelect(file)
          }}
          onClick={() => onSelect(file)}
          className={`w-full px-3 py-2 text-left transition-colors ${
            idx === selectedIndex
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          <div className="font-mono text-sm font-medium">
            {getFilename(file)}
          </div>
          <div className="text-xs opacity-70 mt-0.5">
            {getDirectory(file)}
          </div>
        </button>
      ))}
    </div>
  )
}
