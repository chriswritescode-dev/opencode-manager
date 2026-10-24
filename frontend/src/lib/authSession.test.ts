import { beforeEach, describe, expect, it } from 'vitest'
import {
  STORED_AUTH_USER_KEY,
  clearStoredAuthUser,
  readStoredAuthUser,
  reconcileStoredAuthUser,
  writeStoredAuthUser,
} from './authSession'

const STORED_USER = { id: 'user-1', email: 'user@example.com', name: 'Ada' }

function storedValue(): unknown {
  return JSON.parse(localStorage.getItem(STORED_AUTH_USER_KEY) ?? 'null')
}

describe('reconcileStoredAuthUser', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves a validated user and returns the profile without its extra fields', () => {
    const user = { ...STORED_USER, emailVerified: true, sessionToken: 'secret' }

    expect(reconcileStoredAuthUser(user, null)).toEqual(STORED_USER)
    expect(storedValue()).toEqual(STORED_USER)
  })

  it('replaces a previously stored profile with the validated user', () => {
    writeStoredAuthUser(STORED_USER)

    reconcileStoredAuthUser({ id: 'user-2', email: 'two@example.com', name: 'Grace' }, null)

    expect(storedValue()).toEqual({ id: 'user-2', email: 'two@example.com', name: 'Grace' })
  })

  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a 5xx response', { status: 503, statusText: 'Service Unavailable' }],
  ])('keeps the stored profile on %s', (_label, error) => {
    writeStoredAuthUser(STORED_USER)

    expect(reconcileStoredAuthUser(null, error)).toEqual(STORED_USER)
    expect(storedValue()).toEqual(STORED_USER)
  })

  it('keeps nothing on a transient failure without a stored profile', () => {
    expect(reconcileStoredAuthUser(null, new TypeError('Failed to fetch'))).toBeNull()
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })

  it.each([
    ['a 401 response', { status: 401, statusText: 'Unauthorized' }],
    ['a response without a user', null],
  ])('clears the stored profile on %s', (_label, error) => {
    writeStoredAuthUser(STORED_USER)

    expect(reconcileStoredAuthUser(null, error)).toBeNull()
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })

  it('keeps an unreadable stored profile out of the result', () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, '{not json')

    expect(readStoredAuthUser()).toBeNull()
    expect(reconcileStoredAuthUser(null, new TypeError('Failed to fetch'))).toBeNull()
  })

  it('clears the stored profile through clearStoredAuthUser', () => {
    writeStoredAuthUser(STORED_USER)

    clearStoredAuthUser()

    expect(readStoredAuthUser()).toBeNull()
  })
})
