import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveManagerAuth } from '../src/manager-auth.js'
import { TokenStoreError } from '../src/token-store.js'

const mocks = vi.hoisted(() => ({
  readState: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../src/state.js', () => ({ readState: mocks.readState }))
vi.mock('../src/internal-token-store.js', () => ({ getToken: mocks.getToken }))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('resolveManagerAuth', () => {
  it('reports no manager when no state is stored', async () => {
    mocks.readState.mockReturnValue(null)

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
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

  it('reports a token store failure', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockRejectedValue(new TokenStoreError('keychain locked', 'keychain'))

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
      message: 'Token store unavailable: keychain locked',
    })
  })

  it('reports a missing token', async () => {
    mocks.readState.mockReturnValue({ managerUrl: 'https://mgr.example' })
    mocks.getToken.mockResolvedValue(null)

    await expect(resolveManagerAuth()).resolves.toEqual({
      ok: false,
      message: 'No token stored. Run `ocm login https://mgr.example`.',
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
