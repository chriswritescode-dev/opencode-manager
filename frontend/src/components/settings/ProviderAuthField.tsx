import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { MultiSelect } from '@/components/ui/multi-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExternalFieldCard } from '@/components/ui/external-field-card'
import type { FormField, FormValue } from '@/api/oauth'

interface ProviderAuthFieldProps {
  field: FormField
  value: FormValue | undefined
  disabled: boolean
  onChange: (value: FormValue | undefined) => void
}

function fieldLabel(field: FormField): string {
  return field.title ?? field.key
}

function FieldControl({ field, value, disabled, onChange }: ProviderAuthFieldProps) {
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
          {fieldLabel(field)}
        </Label>
      </div>
    )
  }

  if (field.type === 'number' || field.type === 'integer') {
    return (
      <Input
        id={field.key}
        type="number"
        value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        min={typeof field.minimum === 'number' ? field.minimum : undefined}
        max={typeof field.maximum === 'number' ? field.maximum : undefined}
        step={field.type === 'integer' ? 1 : 'any'}
        className="bg-background border-border"
        disabled={disabled}
      />
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

  if (field.type === 'string' && field.options && field.options.length > 0) {
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

  return (
    <Input
      id={field.key}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.type === 'string' ? field.placeholder : undefined}
      className="bg-background border-border"
      disabled={disabled}
    />
  )
}

export function ProviderAuthField(props: ProviderAuthFieldProps) {
  const { field } = props

  if (field.type === 'external') {
    return <ExternalFieldCard field={field} />
  }

  return (
    <div className="space-y-2">
      {field.type !== 'boolean' && <Label htmlFor={field.key}>{fieldLabel(field)}</Label>}
      <FieldControl {...props} />
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  )
}
