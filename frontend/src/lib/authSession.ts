import { readStoredValue, removeStoredValue, writeStoredValue } from './persistentStorage'
import type { AuthUser } from './auth-client'

export type StoredAuthUser = Pick<AuthUser, 'id' | 'email' | 'name'>

export const STORED_AUTH_USER_KEY = 'ocm.auth.user'

function isStoredAuthUser(value: unknown): value is StoredAuthUser {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.email === 'string' &&
    typeof candidate.name === 'string'
  )
}

/**
 * Reads the profile saved by the last successful session validation. A missing, corrupt or partial
 * record is treated as absent so a failed write cannot wedge the offline restore path.
 */
export function readStoredAuthUser(): StoredAuthUser | null {
  const raw = readStoredValue(STORED_AUTH_USER_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isStoredAuthUser(parsed) ? toStoredAuthUser(parsed) : null
  } catch {
    return null
  }
}

/** Keeps only the fields the offline restore needs, so no session tokens reach storage. */
export function toStoredAuthUser(user: StoredAuthUser): StoredAuthUser {
  return { id: user.id, email: user.email, name: user.name }
}

/** Saves the validated profile so a later cold start can open the app before the network answers. */
export function writeStoredAuthUser(user: StoredAuthUser): void {
  writeStoredValue(STORED_AUTH_USER_KEY, toStoredAuthUser(user))
}

/** Deletes the saved profile after logout or after the server rejected the session. */
export function clearStoredAuthUser(): void {
  removeStoredValue(STORED_AUTH_USER_KEY)
}

/**
 * Whether a failed session read is transient (network error, 5xx, timeout, abort) rather than the
 * server rejecting the session. better-auth reports HTTP failures as an `error` carrying `status`
 * and a rejected fetch as a thrown error with no status, so only an explicit 401 counts as
 * authoritative.
 */
export function isTransientSessionError(error: unknown): boolean {
  if (error === null || error === undefined) return false
  if (typeof error === 'object' && 'status' in error) {
    return (error as { status?: unknown }).status !== 401
  }
  return true
}

/**
 * Applies the stored-profile rule to one session read and keeps storage in step with it.
 *
 * A validated user replaces the saved profile; a transient failure keeps whatever was saved, so an
 * offline cold start still opens the app; anything else is authoritative and deletes the profile.
 *
 * @param user The user of a validated session, or `null` when the read returned none.
 * @param error The session read error, if the read failed.
 * @returns The profile that now stands for the session, or `null` when the app is signed out.
 */
export function reconcileStoredAuthUser(
  user: StoredAuthUser | null,
  error: unknown,
): StoredAuthUser | null {
  if (user !== null) {
    const storedUser = toStoredAuthUser(user)
    writeStoredAuthUser(storedUser)
    return storedUser
  }

  if (isTransientSessionError(error)) return readStoredAuthUser()

  clearStoredAuthUser()
  return null
}
