import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
  description?: string
}

interface MultiSelectProps {
  value: string[]
  onChange: (values: string[]) => void
  options: MultiSelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(search.toLowerCase()) ||
    option.value.toLowerCase().includes(search.toLowerCase()) ||
    (option.description?.toLowerCase().includes(search.toLowerCase()))
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  const handleToggle = useCallback((optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(v => v !== optionValue))
    } else {
      onChange([...value, optionValue])
    }
  }, [value, onChange])

  const handleRemove = useCallback((optionValue: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter(v => v !== optionValue))
  }, [value, onChange])

  const handleOpen = () => {
    if (disabled) return
    setIsOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setSearch('')
    }
  }, [isOpen])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      setSearch('')
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredOptions[highlightedIndex]) {
        handleToggle(filteredOptions[highlightedIndex].value)
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false)
      setSearch('')
    }
  }, [highlightedIndex, filteredOptions, handleToggle])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        ref={triggerRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen ? `option-${highlightedIndex}` : undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={handleOpen}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm transition-colors cursor-pointer',
          'focus-within:outline-none focus-within:ring-1 focus-within:ring-ring',
          disabled && 'cursor-not-allowed opacity-50',
          value.length === 0 && 'pr-8'
        )}
      >
        {value.length === 0 && (
          <span className="text-muted-foreground text-sm">{placeholder}</span>
        )}
        {value.map(v => {
          const option = options.find(o => o.value === v)
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium"
            >
              {option?.label ?? v}
              <button
                type="button"
                onClick={(e) => handleRemove(v, e)}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground disabled:pointer-events-none"
                aria-label={`Remove ${option?.label ?? v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <ChevronDown className={cn(
          'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform',
          isOpen && 'rotate-180'
        )} />
      </div>

      {isOpen && (
        <div className="absolute z-[150] mt-1 w-full bg-popover border border-border rounded-md shadow-lg">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search skills..."
              className={cn(
                'flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
                'placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            />
          </div>
          <div className="max-h-52 overflow-y-auto" role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No skills found</div>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = value.includes(option.value)
                const isHighlighted = index === highlightedIndex
                return (
                  <button
                    key={option.value}
                    id={`option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleToggle(option.value)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                      isSelected && 'bg-primary/5',
                      isHighlighted && 'bg-accent'
                    )}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                    )}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-muted-foreground truncate">{option.description}</div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
