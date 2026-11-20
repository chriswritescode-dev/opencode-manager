import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface UsageModelFilterProps {
  models: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function UsageModelFilter({ models, selected, onChange }: UsageModelFilterProps) {
  const firstSelected = selected[0]

  function toggleModel(model: string) {
    const next = selected.includes(model)
      ? selected.filter((key) => key !== model)
      : [...selected, model]
    onChange(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filter by model"
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="max-w-[12rem] truncate">{firstSelected ?? 'All models'}</span>
          {selected.length > 1 && <Badge variant="secondary">+{selected.length - 1} more</Badge>}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuCheckboxItem checked={selected.length === 0} onCheckedChange={() => onChange([])}>
          All models
        </DropdownMenuCheckboxItem>
        {models.map((model) => (
          <DropdownMenuCheckboxItem
            key={model}
            checked={selected.includes(model)}
            onCheckedChange={() => toggleModel(model)}
          >
            {model}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
