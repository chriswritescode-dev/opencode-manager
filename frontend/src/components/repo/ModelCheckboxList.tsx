import { memo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import type { ModelSection } from '@/lib/modelSections'

interface ModelCheckboxListProps {
  sections: ModelSection[]
  selectedModels: string[]
  onToggle: (value: string, checked: boolean) => void
  emptyLabel: string
  maxSelected?: number
}

export const ModelCheckboxList = memo(function ModelCheckboxList({
  sections,
  selectedModels,
  onToggle,
  emptyLabel,
  maxSelected,
}: ModelCheckboxListProps) {
  if (sections.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <>
      {sections.map((section) => (
        <div key={section.key} className="p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {section.icon ? <section.icon className="h-3.5 w-3.5" /> : null}
            {section.title}
          </p>
          {section.options.map((option) => {
            const checked = selectedModels.includes(option.value)
            const atCapacity = maxSelected !== undefined && selectedModels.length >= maxSelected && !checked
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={option.label}
                  checked={checked}
                  disabled={atCapacity}
                  onCheckedChange={(next) => onToggle(option.value, next === true)}
                />
                <span className="truncate">{option.label}</span>
                {section.pinned ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.providerName}</span>
                ) : null}
              </label>
            )
          })}
        </div>
      ))}
    </>
  )
})
