import { describe, it, expect, vi } from 'vitest'
import { managerAuthDeps, resolveManagerAuth, resolveManagerApi } from '../src/manager-auth.js'
import type { ManagerAuthDeps } from '../src/manager-auth.js'
import { ManagerApi } from '../src/manager-api.js'
import { TokenStoreError } from '../src/token-store.js'
import type { TokenStoreDescription } from '../src/token-store.js'

const STORE: TokenStoreDescription = { kind: 'file', location: '/tmp/credentials.json' }
const STORE_LABEL = 'file: /tmp/credentials.json'

function authDeps(overrides: Partial<ManagerAuthDeps> = {}): ManagerAuthDeps {
  return {
    readState: () => ({ managerUrl: 'https://mgr.example' }),
    getToken: async () => 'tok',
    describeTokenStore: () => STORE,
    ...overrides,
  }
}

describe('resolveManagerAuth', () => {
  it('reports no manager when no state is stored', async () => {
    const getToken = vi.fn<ManagerAuthDeps['getToken']>()
    const deps = authDeps({ readState: () => null, getToken })

    await expect(resolveManagerAuth(undefined, deps)).resolves.toEqual({
      ok: false,
      reason: 'no-manager',
      message: 'No manager configured. Run `ocm login <url>` first.',
    })
    expect(getToken).not.toHaveBeenCalled()
  })

  it('does not read state when given an explicit manager URL', async () => {
    const deps = authDeps({
      readState: () => {
        throw new Error('state must not be read when a URL is given')
      },
    })

    await expect(resolveManagerAuth('https://mgr.example', deps)).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
  })

  it('looks up the token under the normalized manager URL', async () => {
    const getToken = vi.fn<ManagerAuthDeps['getToken']>(async () => 'tok')

    await expect(resolveManagerAuth('  https://mgr.example//  ', authDeps({ getToken }))).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
    expect(getToken).toHaveBeenCalledWith('https://mgr.example')
  })

  it('reports a token store failure with the store kind and location', async () => {
    const deps = authDeps({
      getToken: async () => {
        throw new TokenStoreError('keychain locked', 'keychain')
      },
    })

    await expect(resolveManagerAuth(undefined, deps)).resolves.toEqual({
      ok: false,
      reason: 'token-store',
      message: `token store error (${STORE_LABEL}): keychain locked. Run \`ocm login https://mgr.example\` after fixing the store.`,
    })
  })

  it('rethrows a non token-store error', async () => {
    const deps = authDeps({
      getToken: async () => {
        throw new Error('boom')
      },
    })

    await expect(resolveManagerAuth(undefined, deps)).rejects.toThrow('boom')
  })

  it('reports a missing token with the store kind and location', async () => {
    const deps = authDeps({ getToken: async () => null })

    await expect(resolveManagerAuth(undefined, deps)).resolves.toEqual({
      ok: false,
      reason: 'no-token',
      message: `no token stored for https://mgr.example (${STORE_LABEL}). Run \`ocm login https://mgr.example\`.`,
    })
  })

  it('resolves the manager URL from state and the token from the store', async () => {
    await expect(resolveManagerAuth(undefined, authDeps())).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
  })
})

describe('resolveManagerApi', () => {
  it('builds an api from the resolved auth', async () => {
    const result = await resolveManagerApi(undefined, authDeps())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auth).toEqual({ ok: true, managerUrl: 'https://mgr.example', token: 'tok' })
    expect(result.api).toBeInstanceOf(ManagerApi)
  })

  it('reports the auth failure message without building an api', async () => {
    await expect(resolveManagerApi(undefined, authDeps({ readState: () => null }))).resolves.toEqual({
      ok: false,
      message: 'No manager configured. Run `ocm login <url>` first.',
    })
  })
})

describe('managerAuthDeps', () => {
  it('defaults to the real state and token store lookups', () => {
    expect(managerAuthDeps.readState).toBeTypeOf('function')
    expect(managerAuthDeps.getToken).toBeTypeOf('function')
    expect(managerAuthDeps.describeTokenStore).toBeTypeOf('function')
  })
})
