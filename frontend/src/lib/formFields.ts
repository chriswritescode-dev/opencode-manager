import type {
  FormAnswer,
  FormField,
  FormValue,
  FormWhen,
  IntegrationMethod,
} from '@opencode-manager/shared/opencode'

export function methodIdentifier(method: IntegrationMethod): string {
  return 'id' in method ? method.id : method.type
}

function normalizeSpecialNumber(value: string | number): string | number {
  if (value === 'Infinity') return Number.POSITIVE_INFINITY
  if (value === '-Infinity') return Number.NEGATIVE_INFINITY
  if (value === 'NaN') return Number.NaN
  return value
}

function valuesEqual(
  left: string | number | boolean,
  right: string | number | boolean,
): boolean {
  if (typeof left === 'boolean' || typeof right === 'boolean') return left === right
  const normalizedLeft = normalizeSpecialNumber(left)
  const normalizedRight = normalizeSpecialNumber(right)
  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    return Object.is(normalizedLeft, normalizedRight)
  }
  return normalizedLeft === normalizedRight
}

function matchesCondition(condition: FormWhen, answers: FormAnswer): boolean {
  const value = answers[condition.key]
  if (value === undefined) return false
  const matches = Array.isArray(value)
    ? value.some((entry) => valuesEqual(entry, condition.value))
    : valuesEqual(value, condition.value)
  return condition.op === 'eq' ? matches : !matches
}

function fieldDefault(field: FormField): FormValue | undefined {
  if (field.type === 'external') return undefined
  const value = field.default
  if (value === undefined) return undefined
  return Array.isArray(value) ? [...value] : value
}

export function defaultAnswers(fields: readonly FormField[]): FormAnswer {
  const answer: FormAnswer = {}
  for (const field of fields) {
    const value = fieldDefault(field)
    if (value !== undefined) answer[field.key] = value
  }
  return answer
}

export function isFieldVisible(field: FormField, answers: FormAnswer): boolean {
  if (field.type === 'external') return true
  if (field.hidden === true) return false
  return field.when === undefined || field.when.every((condition) => matchesCondition(condition, answers))
}

export function visibleFields(fields: readonly FormField[], answers: FormAnswer): FormField[] {
  return fields.filter((field) => isFieldVisible(field, answers))
}

function isFieldAnswered(field: FormField, answers: FormAnswer): boolean {
  if (field.type === 'external') return true
  const value = answers[field.key]
  if (value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function isMissingAnswer(field: FormField, answers: FormAnswer): boolean {
  if (field.type === 'external' || field.required !== true) return false
  return !isFieldAnswered(field, answers)
}

export function hasMissingAnswers(fields: readonly FormField[], answers: FormAnswer): boolean {
  return visibleFields(fields, answers).some((field) => isMissingAnswer(field, answers))
}

export function buildAnswer(fields: readonly FormField[], answers: FormAnswer): FormAnswer {
  const result: FormAnswer = {}
  for (const field of visibleFields(fields, answers)) {
    if (field.type === 'external') continue
    const value = answers[field.key]
    if (value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    result[field.key] = value
  }
  return result
}

export function resolveAnswers(
  fields: readonly FormField[] | undefined,
  stored: FormAnswer | undefined,
): FormAnswer {
  return { ...defaultAnswers(fields ?? []), ...stored }
}

export function hasFields(fields: readonly FormField[] | undefined): boolean {
  return (fields?.length ?? 0) > 0
}

export function setAnswerValue(
  answers: Record<string, FormAnswer>,
  methodID: string,
  key: string,
  value: FormValue | undefined,
): Record<string, FormAnswer> {
  const next = { ...(answers[methodID] ?? {}) }
  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = value
  }
  return { ...answers, [methodID]: next }
}
