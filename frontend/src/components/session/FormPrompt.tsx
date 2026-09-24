import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ExternalFieldCard } from '@/components/ui/external-field-card'
import type { FormAnswer, FormField, FormInfo } from '@opencode-manager/shared/opencode'
import { buildAnswer, hasMissingAnswers, visibleFields } from '@/lib/formFields'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'

type AnswerableFormField = Exclude<FormField, { type: 'external' }>

function isAnswerableField(field: FormField): field is AnswerableFormField {
  return field.type !== 'external' && field.hidden !== true
}

function getFieldDefault(field: AnswerableFormField): FormAnswer[string] | undefined {
  if (field.type === 'multiselect') {
    return Array.isArray(field.default) ? [...field.default] : undefined
  }
  return field.default
}

function isPredefinedValue(field: AnswerableFormField, value: string): boolean {
  if (!('options' in field)) return false
  return (field.options ?? []).some((option) => option.value === value)
}

function usesCustomInput(field: AnswerableFormField): boolean {
  return field.type === 'string' && field.custom === true && (field.options?.length ?? 0) > 0
}

interface FormPromptState {
  answer: FormAnswer
  customValues: Record<string, string[]>
  customDrafts: Record<string, string>
}

function buildInitialState(fields: AnswerableFormField[]): FormPromptState {
  const answer: FormAnswer = {}
  const customValues: Record<string, string[]> = {}
  const customDrafts: Record<string, string> = {}
  for (const field of fields) {
    const value = getFieldDefault(field)
    if (value === undefined) continue
    if (field.type === 'multiselect') {
      const entries = Array.isArray(value) ? value : []
      const predefined = entries.filter((entry) => isPredefinedValue(field, entry))
      const custom = entries.filter((entry) => !isPredefinedValue(field, entry))
      if (predefined.length > 0) answer[field.key] = predefined
      if (custom.length > 0) customValues[field.key] = [...new Set(custom)]
      continue
    }
    if (typeof value === 'string' && usesCustomInput(field) && !isPredefinedValue(field, value)) {
      customDrafts[field.key] = value
      continue
    }
    answer[field.key] = value
  }
  return { answer, customValues, customDrafts }
}

interface FormPromptProps {
  form: FormInfo
  onReply: (formID: string, answer: FormAnswer) => Promise<void>
  onCancel: (formID: string) => Promise<void>
  onMinimize?: () => void
}

export function FormPrompt({ form, onReply, onCancel, onMinimize }: FormPromptProps) {
  const candidateFields = form.fields.filter(isAnswerableField)
  const [state, setState] = useState<FormPromptState>(() => buildInitialState(candidateFields))
  const { answer, customValues, customDrafts } = state
  const [expandedCustom, setExpandedCustom] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const formControlId = useId()

  const controlId = (key: string) => `${formControlId}-${key}`

  const setFieldAnswer = (key: string, value: FormAnswer[string]) => {
    setState((prev) => ({ ...prev, answer: { ...prev.answer, [key]: value } }))
  }

  const setCustomDraft = (key: string, value: string) => {
    setState((prev) => ({ ...prev, customDrafts: { ...prev.customDrafts, [key]: value } }))
  }

  const removeCustomValue = (key: string, value: string) => {
    setState((prev) => ({
      ...prev,
      customValues: {
        ...prev.customValues,
        [key]: (prev.customValues[key] ?? []).filter((entry) => entry !== value),
      },
    }))
  }

  const toggleMultiOption = (key: string, optionValue: string, selected: string[]) => {
    setFieldAnswer(
      key,
      selected.includes(optionValue)
        ? selected.filter((entry) => entry !== optionValue)
        : [...selected, optionValue],
    )
  }

  const getEffectiveAnswer = (field: AnswerableFormField): FormAnswer[string] | undefined => {
    const value = answer[field.key]
    if (field.type === 'multiselect') {
      const predefined = Array.isArray(value) ? value : []
      const custom = customValues[field.key] ?? []
      const draft = (customDrafts[field.key] ?? '').trim()
      const combined = [...new Set([...predefined, ...custom, ...(draft === '' ? [] : [draft])])]
      return combined.length > 0 ? combined : undefined
    }
    if (usesCustomInput(field)) {
      const draft = customDrafts[field.key]
      if (draft !== undefined && draft !== '') return draft
    }
    return value
  }

  const effectiveAnswers: FormAnswer = {}
  for (const field of candidateFields) {
    const value = getEffectiveAnswer(field)
    if (value !== undefined) effectiveAnswers[field.key] = value
  }

  const renderFields = visibleFields(form.fields, effectiveAnswers)
  const canSubmit = !hasMissingAnswers(form.fields, effectiveAnswers)
  const buildSubmission = (): FormAnswer => buildAnswer(form.fields, effectiveAnswers)

  const handleMinimize = () => {
    setIsMinimized(true)
    onMinimize?.()
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      await onReply(form.id, buildSubmission())
    } catch {
      showToast.error('Failed to submit form')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    setIsSubmitting(true)
    try {
      await onCancel(form.id)
    } catch {
      showToast.error('Failed to dismiss form')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isMinimized && !expandedCustom) {
        setIsMinimized(true)
        onMinimize?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMinimized, expandedCustom, onMinimize])

  const renderField = (field: AnswerableFormField) => {
    const value = answer[field.key]
    const label = field.title ?? field.key
    const required = field.required === true
    const inputId = controlId(field.key)
    const descriptionId = field.description ? `${inputId}-description` : undefined

    if (field.type === 'boolean') {
      const selected = typeof value === 'boolean' ? value : undefined
      return (
        <FieldGroup key={field.key} label={label} description={field.description} required={required}>
          <div className="flex gap-1.5 sm:gap-2">
            <OptionButton selected={selected === true} label="Yes" onClick={() => setFieldAnswer(field.key, true)} />
            <OptionButton selected={selected === false} label="No" onClick={() => setFieldAnswer(field.key, false)} />
          </div>
        </FieldGroup>
      )
    }

    if (field.type === 'number' || field.type === 'integer') {
      const numberValue = typeof value === 'number' || typeof value === 'string' ? value : ''
      return (
        <div key={field.key} className="space-y-2">
          <FieldLabel id={inputId} label={label} description={field.description} required={required} />
          <input
            id={inputId}
            type="number"
            aria-describedby={descriptionId}
            value={numberValue}
            min={typeof field.minimum === 'number' ? field.minimum : undefined}
            max={typeof field.maximum === 'number' ? field.maximum : undefined}
            step={field.type === 'integer' ? 1 : 'any'}
            onChange={(e) => setFieldAnswer(field.key, e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-white/60 dark:bg-white/5 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      )
    }

    if (field.type === 'multiselect') {
      const selected = Array.isArray(value) ? value : []
      const customEntries = customValues[field.key] ?? []
      const customValue = customDrafts[field.key] ?? ''
      return (
        <FieldGroup key={field.key} label={label} description={field.description} required={required}>
          <div className="space-y-1.5 sm:space-y-2">
            {field.options.map((option) => (
              <OptionButton
                key={option.value}
                selected={selected.includes(option.value)}
                label={option.label}
                description={option.description}
                onClick={() => toggleMultiOption(field.key, option.value, selected)}
              />
            ))}
            {customEntries.map((entry) => (
              <OptionButton
                key={`custom-${entry}`}
                selected
                label={entry}
                onClick={() => removeCustomValue(field.key, entry)}
              />
            ))}
            {field.custom && (
              <CustomOption
                fieldLabel={label}
                expanded={expandedCustom === field.key}
                selected={customValue.trim() !== ''}
                value={customValue}
                onExpand={() => setExpandedCustom(field.key)}
                onCollapse={() => setExpandedCustom(null)}
                onChange={(input) => setCustomDraft(field.key, input)}
              />
            )}
          </div>
        </FieldGroup>
      )
    }

    if (field.options && field.options.length > 0) {
      const selected = typeof value === 'string' ? value : ''
      const customValue = customDrafts[field.key] ?? ''
      return (
        <FieldGroup key={field.key} label={label} description={field.description} required={required}>
          <div className="space-y-1.5 sm:space-y-2">
            {field.options.map((option) => (
              <OptionButton
                key={option.value}
                selected={selected === option.value}
                label={option.label}
                description={option.description}
                onClick={() => {
                  setFieldAnswer(field.key, option.value)
                  setCustomDraft(field.key, '')
                  setExpandedCustom(null)
                }}
              />
            ))}
            {field.custom && (
              <CustomOption
                fieldLabel={label}
                expanded={expandedCustom === field.key}
                selected={customValue !== ''}
                value={customValue}
                onExpand={() => {
                  setFieldAnswer(field.key, '')
                  setExpandedCustom(field.key)
                }}
                onCollapse={() => setExpandedCustom(null)}
                onChange={(input) => setCustomDraft(field.key, input)}
              />
            )}
          </div>
        </FieldGroup>
      )
    }

    return (
      <div key={field.key} className="space-y-2">
        <FieldLabel id={inputId} label={label} description={field.description} required={required} />
        <Textarea
          id={inputId}
          aria-describedby={descriptionId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setFieldAnswer(field.key, e.target.value)}
          placeholder={field.placeholder ?? 'Type your answer...'}
          className="min-h-[60px] sm:min-h-[80px] text-[16px] sm:text-xs md:text-sm resize-none border-blue-500/30 focus:border-blue-500"
        />
      </div>
    )
  }

  return (
    <div className="w-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-950 dark:to-blue-900 border-2 border-blue-300 dark:border-blue-700 rounded-xl shadow-lg shadow-blue-500/20 mb-1 overflow-hidden">
      <div className="flex items-center px-3 py-2 sm:px-4 sm:py-2.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/50">
        <button
          onClick={() => (isMinimized ? setIsMinimized(false) : handleMinimize())}
          aria-expanded={!isMinimized}
          className="flex items-center gap-1.5 flex-1 text-left text-xs sm:text-sm font-semibold text-blue-600 dark:text-white"
        >
          {isMinimized ? (
            <ChevronUp className="w-3 h-3 opacity-60 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-60 flex-shrink-0" />
          )}
          {form.title || 'Form'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isSubmitting}
          aria-label="Dismiss form"
          className="p-1.5 sm:p-2 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {!isMinimized && (
        <div className="p-2 sm:p-3 max-h-[50vh] sm:max-h-[70vh] overflow-y-auto overflow-x-hidden bg-background/60 dark:bg-black/30 space-y-3">
          {renderFields.map((field) =>
            field.type === 'external' ? (
              <ExternalFieldCard key={field.key} field={field} />
            ) : (
              renderField(field)
            ),
          )}
        </div>
      )}

      <div className="flex gap-1.5 sm:gap-2 px-2 py-2 sm:px-3 sm:py-3 border-t border-blue-200 dark:border-blue-800">
        <Button
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="flex-1 h-8 sm:h-10 text-xs sm:text-sm bg-muted hover:bg-muted/80 text-foreground"
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || !canSubmit}
          className="flex-1 h-8 sm:h-10 text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : 'Submit'}
        </Button>
      </div>
    </div>
  )
}

function FieldLabel({
  id,
  label,
  description,
  required,
}: {
  id: string
  label: string
  description?: string
  required: boolean
}) {
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="block text-xs sm:text-sm font-semibold text-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {description && (
        <p id={`${id}-description`} className="text-[10px] sm:text-xs text-foreground/70">
          {description}
        </p>
      )}
    </div>
  )
}

function FieldGroup({
  label,
  description,
  required,
  children,
}: {
  label: string
  description?: string
  required: boolean
  children: ReactNode
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs sm:text-sm font-semibold text-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </legend>
      {description && <p className="text-[10px] sm:text-xs text-foreground/70">{description}</p>}
      {children}
    </fieldset>
  )
}

function OptionButton({
  selected,
  label,
  description,
  onClick,
}: {
  selected: boolean
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'w-full text-left p-2 sm:p-3 rounded-lg transition-all duration-200 active:scale-[0.98]',
        selected
          ? 'bg-blue-200 dark:bg-blue-700/50'
          : 'bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10',
      )}
    >
      <div className="flex items-start gap-1.5 sm:gap-2">
        <div
          className={cn(
            'w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
            selected ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground',
          )}
        >
          {selected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
        </div>
        <div className="min-w-0">
          <span
            className={cn(
              'text-xs sm:text-sm font-semibold',
              selected ? 'text-blue-600 dark:text-blue-300' : 'text-foreground',
            )}
          >
            {label}
          </span>
          {description && (
            <p className="text-[10px] sm:text-xs text-foreground/70 mt-0.5">{description}</p>
          )}
        </div>
      </div>
    </button>
  )
}

function CustomOption({
  fieldLabel,
  expanded,
  selected,
  value,
  onExpand,
  onCollapse,
  onChange,
}: {
  fieldLabel: string
  expanded: boolean
  selected: boolean
  value: string
  onExpand: () => void
  onCollapse: () => void
  onChange: (value: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [expanded])

  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => (expanded ? onCollapse() : onExpand())}
        className={cn(
          'w-full text-left p-2 sm:p-3 rounded-lg transition-all duration-200',
          expanded || selected
            ? 'bg-blue-200 dark:bg-blue-700/50'
            : 'bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10',
        )}
      >
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div
            className={cn(
              'w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
              selected ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground',
            )}
          >
            {selected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
          </div>
          <span
            className={cn(
              'text-xs sm:text-sm font-semibold',
              expanded || selected ? 'text-blue-600 dark:text-blue-300' : 'text-foreground',
            )}
          >
            Other...
          </span>
        </div>
      </button>

      {expanded && (
        <div className="ml-5 sm:ml-7 space-y-1.5 sm:space-y-2 animate-in slide-in-from-top-2 duration-200">
          <Textarea
            ref={textareaRef}
            aria-label={`Other answer for ${fieldLabel}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your own answer..."
            className="min-h-[60px] sm:min-h-[80px] text-[16px] sm:text-xs md:text-sm resize-none border-blue-500/30 focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onCollapse()
              }
              if (e.key === 'Escape') {
                onCollapse()
              }
            }}
          />
        </div>
      )}

      {!expanded && selected && (
        <div className="ml-5 sm:ml-7 text-[10px] sm:text-xs text-muted-foreground">
          {value}
        </div>
      )}
    </>
  )
}
