import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ExternalFieldCard } from '@/components/ui/external-field-card'
import type { FormAnswer, FormField, FormInfo } from '@opencode-manager/shared/opencode'
import { buildAnswer, hasMissingAnswers, visibleFields } from '@/lib/formFields'
import { clearFormDraft, loadFormDraft, saveFormDraft, type FormDraft } from '@/lib/formDrafts'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { useShortcutActions } from '@/contexts/KeyboardShortcutsContext'
import { useMobile, useSwipeDismiss } from '@/hooks/useMobile'

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

function buildInitialState(fields: AnswerableFormField[]): FormDraft {
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
  const [state, setState] = useState<FormDraft>(() => loadFormDraft(form.id) ?? buildInitialState(candidateFields))
  const { answer, customValues, customDrafts } = state
  const [expandedCustom, setExpandedCustom] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const draftClearedRef = useRef(false)
  const mobileHeaderRef = useRef<HTMLDivElement>(null)
  const formControlId = useId()
  const isMobile = useMobile()

  const handleMinimize = useCallback(() => {
    setIsMinimized(true)
    onMinimize?.()
  }, [onMinimize])

  const { bind, swipeStyles } = useSwipeDismiss(handleMinimize, {
    enabled: !isMinimized,
    threshold: 96,
    suspendsRouteSwipe: false,
  })

  useEffect(() => bind(mobileHeaderRef.current), [bind])

  useEffect(() => {
    if (draftClearedRef.current) return
    saveFormDraft(form.id, state)
  }, [form.id, state])

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

  useShortcutActions({
    abort: !isMinimized && !expandedCustom ? handleMinimize : undefined,
  })

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      await onReply(form.id, buildSubmission())
      draftClearedRef.current = true
      clearFormDraft(form.id)
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
      draftClearedRef.current = true
      clearFormDraft(form.id)
    } catch {
      showToast.error('Failed to dismiss form')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && !isMinimized && !expandedCustom) {
        if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"]')) return
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
          <div className="flex gap-3 md:gap-2">
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
            className="w-full rounded-lg border border-border bg-muted/60 dark:bg-muted/5 px-3.5 py-3 text-base focus:border-primary focus:outline-none md:px-3 md:py-2 md:text-sm"
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
          <div className="space-y-3 md:space-y-2">
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
          <div className="space-y-3 md:space-y-2">
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
          className="min-h-[60px] md:min-h-[80px] text-[16px] md:text-sm resize-none border-primary/30 focus:border-primary"
        />
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-t-[22px] border-t border-primary/40 bg-background bg-gradient-to-b from-primary/15 to-card mb-1 md:flex-none md:rounded-xl md:border-2 md:border-primary/40 md:bg-gradient-to-br md:from-primary/10 md:to-primary/20 md:shadow-lg md:shadow-primary/20"
      style={isMobile ? swipeStyles : undefined}
    >
      <div ref={mobileHeaderRef} className="shrink-0 md:hidden">
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Drag to minimize"
          className="flex h-[22px] w-full items-center justify-center"
        >
          <span aria-hidden="true" className="h-[5px] w-10 rounded-full bg-muted-foreground/40" />
        </button>
        <div className="flex h-11 items-center gap-1 px-1.5">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="min-h-11 min-w-11 px-2 text-left text-base text-primary disabled:opacity-50"
          >
            Dismiss
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {form.title || 'Form'}
          </span>
          <button
            type="button"
            onClick={() => (isMinimized ? setIsMinimized(false) : handleMinimize())}
            aria-label="Minimize form"
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="hidden md:flex items-center px-3 py-2 md:px-4 md:py-2.5 border-b border-primary/20 bg-primary/5">
        <button
          onClick={() => (isMinimized ? setIsMinimized(false) : handleMinimize())}
          aria-expanded={!isMinimized}
          className="flex items-center gap-1.5 flex-1 text-left text-xs md:text-sm font-semibold text-primary"
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
          className="p-1.5 md:p-2 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
        </button>
      </div>

      {!isMinimized && (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-2 pb-6 space-y-7 md:flex-none md:p-3 md:max-h-[70vh] md:space-y-3 md:bg-background/60 dark:md:bg-background/30">
          {renderFields.map((field) =>
            field.type === 'external' ? (
              <ExternalFieldCard key={field.key} field={field} />
            ) : (
              renderField(field)
            ),
          )}
        </div>
      )}

      <div className="relative flex shrink-0 gap-2 px-4 pt-3 pb-3 before:pointer-events-none before:absolute before:-top-8 before:inset-x-0 before:h-8 before:bg-gradient-to-b before:from-transparent before:to-card md:border-t md:border-primary/20 md:px-3 md:py-3 md:before:hidden">
        <Button
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="hidden md:inline-flex flex-1 h-10 text-sm bg-muted hover:bg-muted/80 text-foreground"
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || !canSubmit}
          className="flex-1 h-[52px] rounded-[14px] text-[17px] font-bold bg-success hover:bg-success/90 text-success-foreground md:h-10 md:rounded-md md:text-sm md:font-medium"
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : 'Submit'}
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
    <div className="space-y-1 md:space-y-0.5">
      <label htmlFor={id} className="block text-xl font-bold leading-tight text-foreground md:text-sm md:font-semibold">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {description && (
        <p id={`${id}-description`} className="text-[15px] text-foreground/70 md:text-xs">
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
    <fieldset className="space-y-3 md:space-y-2">
      <legend className="text-xl font-bold leading-tight text-foreground md:text-sm md:font-semibold">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </legend>
      {description && <p className="text-[15px] text-foreground/70 md:text-xs">{description}</p>}
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
        'relative w-full min-h-14 text-left p-4 pl-[18px] rounded-[14px] transition-all duration-200 active:scale-[0.98] md:min-h-0 md:p-3 md:pl-3 md:rounded-lg',
        selected
          ? 'bg-primary/20 ring-1 ring-inset ring-primary/60 md:ring-0'
          : 'bg-muted/40 dark:bg-muted/5 hover:bg-muted/60 dark:hover:bg-muted/10',
      )}
    >
      {selected && (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 rounded-l-[14px] bg-primary md:hidden" />
      )}
      <div className="flex items-start gap-3 md:gap-2">
        <div
          className={cn(
            'w-6 h-6 md:w-5 md:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
            selected ? 'border-primary bg-primary' : 'border-muted-foreground',
          )}
        >
          {selected && <Check className="w-3.5 h-3.5 md:w-3 md:h-3 text-primary-foreground" />}
        </div>
        <div className="min-w-0">
          <span
            className={cn(
              'text-base font-semibold md:text-sm',
              selected ? 'text-primary' : 'text-foreground',
            )}
          >
            {label}
          </span>
          {description && (
            <p className="text-sm leading-snug text-foreground/70 mt-0.5 md:text-xs">{description}</p>
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
          'relative w-full min-h-14 text-left p-4 pl-[18px] rounded-[14px] transition-all duration-200 md:min-h-0 md:p-3 md:pl-3 md:rounded-lg',
          expanded || selected
            ? 'bg-primary/20 ring-1 ring-inset ring-primary/60 md:ring-0'
            : 'bg-muted/40 dark:bg-muted/5 hover:bg-muted/60 dark:hover:bg-muted/10',
        )}
      >
        {(expanded || selected) && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 rounded-l-[14px] bg-primary md:hidden" />
        )}
        <div className="flex items-center gap-3 md:gap-2">
          <div
            className={cn(
              'w-6 h-6 md:w-5 md:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
              selected ? 'border-primary bg-primary' : 'border-muted-foreground',
            )}
          >
            {selected && <Check className="w-3.5 h-3.5 md:w-3 md:h-3 text-primary-foreground" />}
          </div>
          <span
            className={cn(
              'text-base font-semibold md:text-sm',
              expanded || selected ? 'text-primary' : 'text-foreground',
            )}
          >
            Other...
          </span>
        </div>
      </button>

      {expanded && (
        <div className="ml-0 md:ml-7 space-y-3 md:space-y-2 animate-in slide-in-from-top-2 duration-200">
          <Textarea
            ref={textareaRef}
            aria-label={`Other answer for ${fieldLabel}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your own answer..."
            className="min-h-[60px] md:min-h-[80px] text-[16px] md:text-sm resize-none border-primary/30 focus:border-primary"
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
        <div className="ml-0 md:ml-7 text-xs text-muted-foreground">
          {value}
        </div>
      )}
    </>
  )
}
