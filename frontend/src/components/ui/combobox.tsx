import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export interface ComboboxOption {
  value: string
  label: string
  description?: string
  group?: string
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  allowCustomValue?: boolean
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select or type...',
  disabled = false,
  className,
  allowCustomValue = true,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const filteredOptions = options.filter(option =>
    option.value.toLowerCase().includes(inputValue.toLowerCase()) ||
    option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
    (option.description?.toLowerCase().includes(inputValue.toLowerCase()))
  )

  const groupedOptions = filteredOptions.reduce((acc, option) => {
    const group = option.group || ''
    if (!acc[group]) acc[group] = []
    acc[group].push(option)
    return acc
  }, {} as Record<string, ComboboxOption[]>)

  const flatFilteredOptions = Object.values(groupedOptions).flat()

  useEffect(() => {
    setSelectedIndex(0)
  }, [inputValue])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        if (allowCustomValue) {
          onChange(inputValue)
        } else if (!options.some(o => o.value === inputValue)) {
          setInputValue(value)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, inputValue, value, onChange, options, allowCustomValue])

  useEffect(() => {
    if (!isOpen || !listRef.current) return

    const items = listRef.current.querySelectorAll('[data-option]')
    const selectedItem = items[selectedIndex] as HTMLElement
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isOpen])

  const handleSelect = useCallback((optionValue: string) => {
    setInputValue(optionValue)
    onChange(optionValue)
    setIsOpen(false)
    inputRef.current?.blur()
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, flatFilteredOptions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (flatFilteredOptions[selectedIndex]) {
          handleSelect(flatFilteredOptions[selectedIndex].value)
        } else if (allowCustomValue && inputValue) {
          handleSelect(inputValue)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setInputValue(value)
        break
      case 'Tab':
        setIsOpen(false)
        if (allowCustomValue) {
          onChange(inputValue)
        }
        break
    }
  }, [isOpen, selectedIndex, flatFilteredOptions, handleSelect, allowCustomValue, inputValue, value, onChange])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    setIsOpen(true)
    if (allowCustomValue) {
      onChange(newValue)
    }
  }, [allowCustomValue, onChange])

  const handleFocus = useCallback(() => {
    setIsOpen(true)
  }, [])

  let optionIndex = -1

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            'file:border-0 file:bg-transparent file:text-sm file:font-medium',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'pr-8'
          )}
        />
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              setIsOpen(!isOpen)
              inputRef.current?.focus()
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
        </button>
      </div>

      {isOpen && flatFilteredOptions.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto"
        >
          {Object.entries(groupedOptions).map(([group, groupOptions]) => (
            <div key={group || 'default'}>
              {group && (
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
                  {group}
                </div>
              )}
              {groupOptions.map((option) => {
                optionIndex++
                const currentIndex = optionIndex
                const isSelected = currentIndex === selectedIndex

                return (
                  <button
                    key={option.value}
                    data-option
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                    )}
                  >
                    <div className="font-medium">{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-muted-foreground truncate">{option.description}</div>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {isOpen && flatFilteredOptions.length === 0 && inputValue && allowCustomValue && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
          <div className="text-sm text-muted-foreground">
            Press Enter to use "<span className="font-medium text-foreground">{inputValue}</span>"
          </div>
        </div>
      )}
    </div>
  )
}
