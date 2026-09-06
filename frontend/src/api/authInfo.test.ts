import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthConfig, DEFAULT_AUTH_CONFIG, listUserPasskeys } from './authInfo'

describe('getAuthConfig', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed config on success', async () => {
    const config = {
      enabledProviders: ['credentials', 'github'],
      registrationEnabled: true,
      isFirstUser: false,
      adminConfigured: true,
    }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(config), { status: 200 }),
    )

    const result = await getAuthConfig()

    expect(result).toEqual(config)

    const callOptions = fetchMock.mock.calls[0][1]
    expect(callOptions.credentials).toBe('include')
  })

  it('falls back to DEFAULT_AUTH_CONFIG on a non-OK response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'server error' }), { status: 500 }),
    )

    const result = await getAuthConfig()

    expect(result).toEqual(DEFAULT_AUTH_CONFIG)
  })

  it('falls back to DEFAULT_AUTH_CONFIG when the network rejects', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const result = await getAuthConfig()

    expect(result).toEqual(DEFAULT_AUTH_CONFIG)
  })

  it('defaults isFirstUser to false so the setup flow is not offered when config is unknown', () => {
    expect(DEFAULT_AUTH_CONFIG.isFirstUser).toBe(false)
  })
})

describe('listUserPasskeys', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the passkey list and sends credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: 'p1', name: 'laptop' }]), { status: 200 }),
    )

    const result = await listUserPasskeys()

    expect(result).toEqual([{ id: 'p1', name: 'laptop' }])

    const callOptions = fetchMock.mock.calls[0][1]
    expect(callOptions.credentials).toBe('include')
  })

  it('returns an empty array when the request fails', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )

    const result = await listUserPasskeys()

    expect(result).toEqual([])
  })
})
