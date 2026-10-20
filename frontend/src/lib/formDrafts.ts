import type { FormAnswer } from '@opencode-manager/shared/opencode'

export interface FormDraft {
  answer: FormAnswer
  customValues: Record<string, string[]>
  customDrafts: Record<string, string>
}

const DRAFT_KEY_PREFIX = 'opencode-manager:form-draft:'

function draftKey(formId: string): string {
  return `${DRAFT_KEY_PREFIX}${formId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isFormValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isStringArray(value)
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray)
}

function parseDraft(raw: string): FormDraft | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { answer, customValues, customDrafts } = parsed
  if (!isRecord(answer) || !Object.values(answer).every(isFormValue)) return undefined
  if (!isStringArrayRecord(customValues)) return undefined
  if (!isStringRecord(customDrafts)) return undefined
  return {
    answer: answer as FormAnswer,
    customValues,
    customDrafts,
  }
}

/**
 * Returns the persisted draft for a form, or `undefined` when none exists or the stored value is invalid.
 */
export function loadFormDraft(formId: string): FormDraft | undefined {
  try {
    const raw = sessionStorage.getItem(draftKey(formId))
    return raw === null ? undefined : parseDraft(raw)
  } catch {
    return undefined
  }
}

/**
 * Persists a form draft, ignoring storage failures such as disabled storage or an exceeded quota.
 */
export function saveFormDraft(formId: string, draft: FormDraft): void {
  try {
    sessionStorage.setItem(draftKey(formId), JSON.stringify(draft))
  } catch {
    return
  }
}

/**
 * Removes the persisted draft for a form, ignoring storage failures.
 */
export function clearFormDraft(formId: string): void {
  try {
    sessionStorage.removeItem(draftKey(formId))
  } catch {
    return
  }
}
