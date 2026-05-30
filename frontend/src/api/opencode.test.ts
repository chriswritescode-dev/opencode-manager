import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeClient } from './opencode'

describe('OpenCodeClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats empty successful session deletes as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(new OpenCodeClient('/api/opencode', '/repo').deleteSession('ses_1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/session/ses_1?directory=%2Frepo',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('deletes workspaces with directory routing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(new OpenCodeClient('/api/opencode', '/repo').deleteWorkspace('wrk_stale')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/experimental/workspace/wrk_stale?directory=%2Frepo',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('preserves text error responses', async () => {
    fetchMock.mockResolvedValue(new Response('Workspace not found: wrk_stale', { status: 500 }))

    await expect(new OpenCodeClient('/api/opencode', '/repo').deleteSession('ses_1')).rejects.toThrow(
      'Workspace not found: wrk_stale',
    )
  })
})
