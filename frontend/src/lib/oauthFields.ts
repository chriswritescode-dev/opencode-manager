import type {
  PromptAnswer,
  PromptAnswerValue,
  PromptCondition,
  PromptField,
  ProviderAuthMethod,
} from '@/api/oauth'

function matchesCondition(condition: PromptCondition, answer: PromptAnswer): boolean {
  const value = answer[condition.key]
  if (value === undefined) return false
  const hit = Array.isArray(value) ? value.some((item) => item === condition.value) : value === condition.value
  return condition.op === 'eq' ? hit : !hit
}

export function isFieldActive(field: PromptField, answer: PromptAnswer): boolean {
  if (field.type === 'external') return true
  return !field.when || field.when.every((condition) => matchesCondition(condition, answer))
}

export function visibleFields(method: ProviderAuthMethod, answer: PromptAnswer): PromptField[] {
  return (method.fields ?? []).filter((field) => isFieldActive(field, answer))
}

export function hasFields(method: ProviderAuthMethod): boolean {
  return (method.fields?.length ?? 0) > 0
}

export function defaultAnswer(method: ProviderAuthMethod): PromptAnswer {
  const answer: PromptAnswer = {}
  for (const field of method.fields ?? []) {
    if (field.type !== 'external' && field.default !== undefined) answer[field.key] = field.default
  }
  return answer
}

export function isMissingAnswer(field: PromptField, answer: PromptAnswer): boolean {
  const value = answer[field.key]
  if (field.type === 'external') return value !== true
  if (!field.required) return false
  if (value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function hasMissingAnswers(method: ProviderAuthMethod, answer: PromptAnswer): boolean {
  return visibleFields(method, answer).some((field) => isMissingAnswer(field, answer))
}

export function buildAnswer(method: ProviderAuthMethod, answer: PromptAnswer): PromptAnswer {
  const result: PromptAnswer = {}
  for (const field of visibleFields(method, answer)) {
    const value = answer[field.key]
    if (value !== undefined) result[field.key] = value
  }
  return result
}

export function setAnswerValue(
  answers: Record<string, PromptAnswer>,
  methodID: string,
  key: string,
  value: PromptAnswerValue | undefined,
): Record<string, PromptAnswer> {
  const next = { ...(answers[methodID] ?? {}) }
  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = value
  }
  return { ...answers, [methodID]: next }
}
