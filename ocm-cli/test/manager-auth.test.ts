import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveManagerAuth, resolveManagerApi } from '../src/manager-auth.js'
import { ManagerApi } from '../src/manager-api.js'
import { TokenStoreError } from '../src/token-store.js'

const mocks = vi.hoisted(() => ({
  readState: vi.fn(),
  getToken: vi.fn(),
  describeTokenStore: vi.fn(),
}))

vi.mock('../src/state.js', () => ({ readState: mocks.readState }))
vi.mock('../src/internal-token-store.js', () => ({
  getToken: mocks.getToken,
  describeTokenStore: mocks.describeTokenStore,
}))

const STORE = { kind: 'file', location: '/tmp/credentials.json' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.describeTokenStore.mockReturnValue(STORE)
})

describe('resolveManagerAuth', () => {
  it('reports no manager when no state is stored', async () => {
    mocks.readState.mockReturnValue(null)

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
      reason: 'no-manager',
      message: 'No manager configured. Run `ocm login <url>` first.',
    })
    expect(mocks.getToken).not.toHaveBeenCalled()
  })

  it('does not read state when given an explicit manager URL', async () => {
    mocks.readState.mockReturnValue(null)
    mocks.getToken.mockResolvedValue('tok')

    await expect(resolveManagerAuth('https://mgr.example')).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
    expect(mocks.readState).not.toHaveBeenCalled()
    expect(mocks.getToken).toHaveBeenCalledWith('https://mgr.example')
  })

  it('looks up the token under the normalized manager URL', async () => {
    mocks.getToken.mockResolvedValue('tok')

    await expect(resolveManagerAuth('  https://mgr.example//  ')).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
    expect(mocks.getToken).toHaveBeenCalledWith('https://mgr.example')
  })

  it('reports a token store failure with the store kind and location', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockRejectedValue(new TokenStoreError('keychain locked', 'keychain'))

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
      reason: 'token-store',
      message: 'token store error (file: /tmp/credentials.json): keychain locked. Run `ocm login https://mgr.example` after fixing the store.',
    })
  })

  it('rethrows a non token-store error', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockRejectedValue(new Error('boom'))

    await expect(resolveManagerAuth()).rejects.toThrow('boom')
  })

  it('reports a missing token with the store kind and location', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockResolvedValue(null)

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
      reason: 'no-token',
      message: 'no token stored for https://mgr.example (file: /tmp/credentials.json). Run `ocm login https://mgr.example`.',
    })
  })

  it('resolves the manager URL and token', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockResolvedValue('tok')

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: true,
      managerUrl: 'https://mgr.example',
      token: 'tok',
    })
  })
})

describe('resolveManagerApi', () => {
  it('builds an api from the resolved auth', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockResolvedValue('tok')

    const result = await resolveManagerApi()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auth).toEqual({ ok: true, managerUrl: 'https://mgr.example', token: 'tok' })
    expect(result.api).toBeInstanceOf(ManagerApi)
  })

  it('reports the auth failure message without building an api', async () => {
    mocks.readState.mockReturnValue(null)

    await expect(resolveManagerApi()).resolves.toEqual({
      ok: false,
      message: 'No manager configured. Run `ocm login <url>` first.',
    })
  })
})
