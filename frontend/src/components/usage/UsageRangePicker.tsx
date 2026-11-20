import { useId } from 'react'
import { format } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { USAGE_RANGE_LABELS, USAGE_RANGE_PRESETS } from '@/lib/usageRange'
import type { UsageRangePreset, UsageRangeSelection } from '@/lib/usageRange'

const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm"

interface UsageRangePickerProps {
  value: UsageRangeSelection
  onChange: (selection: UsageRangeSelection) => void
}

function formatLocalDateTime(timestamp: number | null): string {
  return timestamp === null ? '' : format(timestamp, LOCAL_DATE_TIME_FORMAT)
}

function parseLocalDateTime(text: string): number | null {
  if (text === '') return null
  const timestamp = new Date(text).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function isBoundedPreset(value: string): value is Exclude<UsageRangePreset, 'custom'> {
  return USAGE_RANGE_PRESETS.some((preset) => preset !== 'custom' && preset === value)
}

export function UsageRangePicker({ value, onChange }: UsageRangePickerProps) {
  const fromId = useId()
  const toId = useId()
  const from = value.preset === 'custom' ? value.from : null
  const to = value.preset === 'custom' ? value.to : null

  const handlePresetChange = (next: string) => {
    if (next === 'custom') {
      if (value.preset !== 'custom') onChange({ preset: 'custom', from: null, to: null })
      return
    }
    if (isBoundedPreset(next)) onChange({ preset: next })
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={value.preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[180px]" aria-label="Range">
          <SelectValue>{USAGE_RANGE_LABELS[value.preset]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {USAGE_RANGE_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {USAGE_RANGE_LABELS[preset]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === 'custom' && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={fromId}>From</Label>
            <Input
              id={fromId}
              type="datetime-local"
              aria-label="From"
              value={formatLocalDateTime(from)}
              onChange={(event) =>
                onChange({ preset: 'custom', from: parseLocalDateTime(event.target.value), to })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={toId}>To</Label>
            <Input
              id={toId}
              type="datetime-local"
              aria-label="To"
              value={formatLocalDateTime(to)}
              onChange={(event) =>
                onChange({ preset: 'custom', from, to: parseLocalDateTime(event.target.value) })
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
