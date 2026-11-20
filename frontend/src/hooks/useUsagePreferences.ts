import { useState, useCallback } from 'react'
import { z } from 'zod'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'
import { usageRangeSelectionSchema } from '@/lib/usageRange'
import type { UsageRangeSelection } from '@/lib/usageRange'

export const USAGE_RANGE_STORAGE_KEY = 'oc:usage:range'
export const SESSION_USAGE_RANGE_STORAGE_KEY = 'oc:usage:session-range'
export const USAGE_MODELS_STORAGE_KEY = 'oc:usage:models'

const usageModelsSchema = z.array(z.string())

function readStoredJson<T extends JsonValue>(
  storageKey: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  const stored = readStoredValue(storageKey)
  if (stored === null) {
    return fallback
  }
  const parsed = schema.safeParse(parseJsonText(stored))
  return parsed.success ? parsed.data : fallback
}

function useStoredJson<T extends JsonValue>(
  storageKey: string,
  schema: z.ZodType<T>,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readStoredJson(storageKey, schema, fallback))

  const setStoredValue = useCallback(
    (next: T) => {
      writeStoredValue(storageKey, next)
      setValue(next)
    },
    [storageKey],
  )

  return [value, setStoredValue]
}

export function useUsageRangePreference(
  storageKey: string,
  fallback: UsageRangeSelection,
): [UsageRangeSelection, (selection: UsageRangeSelection) => void] {
  return useStoredJson(storageKey, usageRangeSelectionSchema, fallback)
}

export function useUsageModelsPreference(): [string[], (models: string[]) => void] {
  return useStoredJson(USAGE_MODELS_STORAGE_KEY, usageModelsSchema, [])
}
