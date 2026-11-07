import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ChangeSourceSchema,
  DEFAULT_CHANGE_SOURCE,
  changeSourceKey,
  toChangeSource,
} from '@opencode-manager/shared/schemas'
import type {
  ChangeSource,
  OutputDefinition,
  OutputParamField,
  OutputParams,
} from '@opencode-manager/shared/schemas'

export interface OutputParamsFormProps {
  definition: OutputDefinition
  params: OutputParams
  onChange: (params: OutputParams) => void
  onPendingChange?: (pending: boolean) => void
}

const CHANGE_SOURCE_OPTIONS: { value: ChangeSource['kind']; label: string }[] = [
  { value: 'session', label: 'This session' },
  { value: 'uncommitted', label: 'Uncommitted' },
  { value: 'staged', label: 'Staged' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'branch', label: 'Branch vs base' },
  { value: 'pullRequest', label: 'Pull request' },
]

interface ChangeSourceDrafts {
  kind: ChangeSource['kind']
  base: string
  number: string
}

function changeSourceDrafts(source: ChangeSource): ChangeSourceDrafts {
  switch (source.kind) {
    case 'session':
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
      return { kind: source.kind, base: '', number: '' }
    case 'branch':
      return { kind: source.kind, base: source.base ?? '', number: '' }
    case 'pullRequest':
      return { kind: source.kind, base: source.base ?? '', number: String(source.number) }
  }
}

interface TextParamControlProps {
  field: Extract<OutputParamField, { type: 'text' }>
  value: unknown
  onChange: (value: unknown) => void
}

function TextParamControl({ field, value, onChange }: TextParamControlProps) {
  return (
    <Input
      aria-label={field.label}
      value={typeof value === 'string' ? value : ''}
      maxLength={field.maxLength}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  )
}

interface NumberParamControlProps {
  field: Extract<OutputParamField, { type: 'number' }>
  value: unknown
  onChange: (value: unknown) => void
}

function NumberParamControl({ field, value, onChange }: NumberParamControlProps) {
  const displayValue = typeof value === 'number' || typeof value === 'string' ? String(value) : ''

  return (
    <Input
      type="number"
      aria-label={field.label}
      value={displayValue}
      min={field.min}
      max={field.max}
      onChange={(event) => {
        const raw = event.target.value
        if (raw === '') {
          onChange(undefined)
          return
        }
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}

interface SelectParamControlProps {
  field: Extract<OutputParamField, { type: 'select' }>
  value: unknown
  onChange: (value: unknown) => void
}

function SelectParamControl({ field, value, onChange }: SelectParamControlProps) {
  return (
    <Select
      value={typeof value === 'string' ? value : undefined}
      onValueChange={(next) => onChange(next)}
    >
      <SelectTrigger aria-label={field.label}>
        <SelectValue />
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

interface ChangeSourceParamControlProps {
  field: Extract<OutputParamField, { type: 'changeSource' }>
  value: unknown
  onChange: (value: ChangeSource) => void
  onPendingChange?: (pending: boolean) => void
}

function ChangeSourceParamControl({
  field,
  value,
  onChange,
  onPendingChange,
}: ChangeSourceParamControlProps) {
  const parsed = ChangeSourceSchema.safeParse(value)
  const current = parsed.success ? parsed.data : DEFAULT_CHANGE_SOURCE
  const currentKey = changeSourceKey(current)
  const [drafts, setDrafts] = useState<ChangeSourceDrafts>(() => changeSourceDrafts(current))
  const [syncedKey, setSyncedKey] = useState(currentKey)

  useEffect(() => {
    if (syncedKey === currentKey) return
    const next = ChangeSourceSchema.safeParse(value)
    setSyncedKey(currentKey)
    setDrafts(changeSourceDrafts(next.success ? next.data : DEFAULT_CHANGE_SOURCE))
  }, [currentKey, syncedKey, value])

  const candidate = toChangeSource({
    kind: drafts.kind,
    base: drafts.base,
    number: Number(drafts.number),
  })
  const pending =
    drafts.kind === 'pullRequest' &&
    (candidate === null || changeSourceKey(candidate) !== currentKey)

  useEffect(() => {
    onPendingChange?.(pending)
  }, [onPendingChange, pending])

  const handleKindChange = (next: ChangeSource['kind']) => {
    setDrafts((previous) => ({ ...previous, kind: next }))
    if (next === 'pullRequest') return
    const nextSource = toChangeSource({ kind: next, base: drafts.base })
    if (nextSource) onChange(nextSource)
  }

  const commitInputs = () => {
    const next = toChangeSource({
      kind: drafts.kind,
      base: drafts.base,
      number: Number(drafts.number),
    })
    if (next) onChange(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={drafts.kind}
        onValueChange={(next) => handleKindChange(next as ChangeSource['kind'])}
      >
        <SelectTrigger aria-label={field.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHANGE_SOURCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {drafts.kind === 'branch' || drafts.kind === 'pullRequest' ? (
        <Input
          aria-label="Base branch"
          placeholder="Default branch"
          value={drafts.base}
          onChange={(event) =>
            setDrafts((previous) => ({ ...previous, base: event.target.value }))
          }
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitInputs()
          }}
        />
      ) : null}

      {drafts.kind === 'pullRequest' ? (
        <Input
          type="number"
          aria-label="Pull request number"
          value={drafts.number}
          onChange={(event) =>
            setDrafts((previous) => ({ ...previous, number: event.target.value }))
          }
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitInputs()
          }}
        />
      ) : null}
    </div>
  )
}

interface OutputParamControlProps {
  field: OutputParamField
  value: unknown
  onChange: (value: unknown) => void
  onPendingChange?: (pending: boolean) => void
}

function OutputParamControl({ field, value, onChange, onPendingChange }: OutputParamControlProps) {
  switch (field.type) {
    case 'text':
      return <TextParamControl field={field} value={value} onChange={onChange} />
    case 'number':
      return <NumberParamControl field={field} value={value} onChange={onChange} />
    case 'select':
      return <SelectParamControl field={field} value={value} onChange={onChange} />
    case 'changeSource':
      return (
        <ChangeSourceParamControl
          field={field}
          value={value}
          onChange={onChange}
          onPendingChange={onPendingChange}
        />
      )
  }
}

/** Renders a definition's parameter fields and reports invalid pull-request selections as pending. */
export function OutputParamsForm({
  definition,
  params,
  onChange,
  onPendingChange,
}: OutputParamsFormProps): ReactNode {
  if (definition.params.length === 0) return null

  const updateParam = (name: string, value: unknown) => {
    const next = { ...params }
    if (value === undefined) delete next[name]
    else next[name] = value
    onChange(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {definition.params.map((field) => (
        <OutputParamControl
          key={field.name}
          field={field}
          value={params[field.name]}
          onChange={(value) => updateParam(field.name, value)}
          onPendingChange={onPendingChange}
        />
      ))}
    </div>
  )
}
