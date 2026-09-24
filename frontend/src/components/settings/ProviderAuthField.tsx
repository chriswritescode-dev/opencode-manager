import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { MultiSelect } from '@/components/ui/multi-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PromptAnswerValue, PromptField } from '@/api/oauth'

interface ProviderAuthFieldProps {
  field: PromptField
  value: PromptAnswerValue | undefined
  disabled: boolean
  onChange: (value: PromptAnswerValue | undefined) => void
}

function FieldControl({ field, value, disabled, onChange }: ProviderAuthFieldProps) {
  if (field.type === 'text') {
    return (
      <Input
        id={field.key}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="bg-background border-border"
        disabled={disabled}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        id={field.key}
        type="number"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        min={field.minimum}
        max={field.maximum}
        className="bg-background border-border"
        disabled={disabled}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
      >
        <SelectTrigger className="bg-background border-border">
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'multiselect') {
    return (
      <MultiSelect
        value={Array.isArray(value) ? value : []}
        onChange={(next) => onChange(next)}
        options={field.options}
        disabled={disabled}
      />
    )
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={field.key}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
        <Label htmlFor={field.key} className="cursor-pointer">
          {field.message}
        </Label>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <a
          href={field.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {field.message}
        </a>
        <Badge variant="secondary" className="text-xs shrink-0">
          External step
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={field.key}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
        <Label htmlFor={field.key} className="cursor-pointer text-sm">
          I have completed this step
        </Label>
      </div>
    </div>
  )
}

export function ProviderAuthField(props: ProviderAuthFieldProps) {
  const { field } = props

  return (
    <div className="space-y-2">
      {field.type !== 'boolean' && field.type !== 'external' && (
        <Label htmlFor={field.key}>{field.message}</Label>
      )}
      <FieldControl {...props} />
    </div>
  )
}
