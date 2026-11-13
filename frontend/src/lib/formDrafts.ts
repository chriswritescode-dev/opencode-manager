import type { FormAnswer } from '@opencode-manager/shared/opencode'
import { FormAnswerSchema } from '@opencode-manager/shared/schemas'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { z } from 'zod'

export interface FormDraft {
  answer: FormAnswer
  customValues: Record<string, string[]>
  customDrafts: Record<string, string>
}

const FormDraftSchema = z.object({
  answer: FormAnswerSchema,
  customValues: z.record(z.string(), z.array(z.string())),
  customDrafts: z.record(z.string(), z.string()),
})

const DRAFT_KEY_PREFIX = 'opencode-manager:form-draft:'

function draftKey(formId: string): string {
  return `${DRAFT_KEY_PREFIX}${formId}`
}

function parseDraft(raw: string): FormDraft | undefined {
  const parsed = FormDraftSchema.safeParse(parseJsonText(raw))
  return parsed.success ? parsed.data : undefined
}

export function loadFormDraft(formId: string): FormDraft | undefined {
  try {
    const raw = sessionStorage.getItem(draftKey(formId))
    return raw === null ? undefined : parseDraft(raw)
  } catch {
    return undefined
  }
}

export function saveFormDraft(formId: string, draft: FormDraft): void {
  try {
    sessionStorage.setItem(draftKey(formId), JSON.stringify(draft))
  } catch {
    return
  }
}

export function clearFormDraft(formId: string): void {
  try {
    sessionStorage.removeItem(draftKey(formId))
  } catch {
    return
  }
}
