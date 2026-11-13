import { useState, useCallback } from 'react'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

const booleanStorageSchema = z.boolean()

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStoredValue(key)
  if (stored === null) {
    return fallback
  }
  const parsed = booleanStorageSchema.safeParse(parseJsonText(stored))
  return parsed.success ? parsed.data : fallback
}

export function usePersistentBoolean(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => readStoredBoolean(key, fallback))

  const toggle = useCallback(() => {
    setValue((prev: boolean) => {
      const newValue = !prev
      writeStoredValue(key, newValue)
      return newValue
    })
  }, [key])

  return [value, toggle]
}
