import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export interface PickerSearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  listId: string
  open: boolean
  activeDescendantId: string | undefined
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  name: string
  trailing?: React.ReactNode
}

export function PickerSearchBar({
  inputRef,
  listId,
  open,
  activeDescendantId,
  value,
  onChange,
  onKeyDown,
  placeholder,
  name,
  trailing,
}: PickerSearchBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 sm:px-0">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendantId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-9 pl-9"
          autoComplete="off"
          name={name}
        />
      </div>
      {trailing}
    </div>
  )
}
