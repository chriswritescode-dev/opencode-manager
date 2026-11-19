import { parseJsonText } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { readStoredValue, removeStoredValue, writeStoredValue } from './persistentStorage'
import type { AuthUser } from './auth-client'

export type StoredAuthUser = Pick<AuthUser, 'id' | 'email' | 'name'>

export const STORED_AUTH_USER_KEY = 'ocm.auth.user'

export const StoredAuthUserSchema: z.ZodType<StoredAuthUser> = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string(),
})

const ErrorStatusSchema = z.looseObject({ status: z.number().optional() })

export function readStoredAuthUser(): StoredAuthUser | null {
  const raw = readStoredValue(STORED_AUTH_USER_KEY)
  if (raw === null) return null
  const parsed = StoredAuthUserSchema.safeParse(parseJsonText(raw))
  return parsed.success ? toStoredAuthUser(parsed.data) : null
}

export function toStoredAuthUser(user: StoredAuthUser): StoredAuthUser {
  return { id: user.id, email: user.email, name: user.name }
}

export function writeStoredAuthUser(user: StoredAuthUser): void {
  writeStoredValue(STORED_AUTH_USER_KEY, toStoredAuthUser(user))
}

export function clearStoredAuthUser(): void {
  removeStoredValue(STORED_AUTH_USER_KEY)
}

export function isTransientSessionError(cause: unknown): boolean {
  if (cause === null || cause === undefined) return false
  const parsed = ErrorStatusSchema.safeParse(cause)
  return parsed.success ? parsed.data.status !== 401 : true
}

export function reconcileStoredAuthUser(
  user: StoredAuthUser | null,
  cause: unknown,
): StoredAuthUser | null {
  if (user !== null) {
    const storedUser = toStoredAuthUser(user)
    writeStoredAuthUser(storedUser)
    return storedUser
  }

  if (isTransientSessionError(cause)) return readStoredAuthUser()

  clearStoredAuthUser()
  return null
}
