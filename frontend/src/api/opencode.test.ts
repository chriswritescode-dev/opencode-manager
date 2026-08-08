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

  describe('listSessionsPage', () => {
    it('handles v1.16.0+ API response format with data envelope and nested location', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'ses_v2_1',
                projectID: 'proj_v2',
                parentID: 'parent_v2',
                title: 'V2 Session',
                time: { created: 3000, updated: 4000 },
                location: { directory: '/my-repo', workspaceID: 'ws_v2' },
                agent: 'default',
                model: { id: 'gpt-4', providerID: 'openai' },
                cost: 0.05,
                tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } },
              },
            ],
            cursor: { next: 'v2_cursor' },
          }),
          { status: 200 },
        ),
      )

      const result = await new OpenCodeClient('/api/opencode', '/repo').listSessionsPage({ limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        id: 'ses_v2_1',
        projectID: 'proj_v2',
        workspaceID: 'ws_v2',
        directory: '/repo',
        parentID: 'parent_v2',
        title: 'V2 Session',
        version: 'v2',
      })
      expect(result.nextCursor).toBe('v2_cursor')
    })

    it('sends first-page params to /api/session with directory and returns adapted sessions', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'ses_1',
                projectID: 'proj_1',
                workspaceID: 'ws_1',
                parentID: 'parent_1',
                title: 'My Session',
                time: { created: 1000, updated: 2000 },
              },
            ],
            cursor: { next: 'cursor_next' },
          }),
          { status: 200 },
        ),
      )

      const result = await new OpenCodeClient('/api/opencode', '/repo').listSessionsPage({
        limit: 25,
        order: 'desc',
        search: 'deploy',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost/api/opencode/api/session?limit=25&order=desc&search=deploy&directory=%2Frepo',
        expect.any(Object),
      )
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        id: 'ses_1',
        projectID: 'proj_1',
        directory: '/repo',
        parentID: 'parent_1',
        title: 'My Session',
        version: 'v2',
        time: { created: 1000, updated: 2000 },
      })
    })

    it('sends cursor-only params without directory for cursor-based requests', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [],
          }),
          { status: 200 },
        ),
      )

      await new OpenCodeClient('/api/opencode', '/repo').listSessionsPage({ cursor: 'cursor_123' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost/api/opencode/api/session?cursor=cursor_123',
        expect.any(Object),
      )
    })

    it('exposes response cursor as nextCursor', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [],
            cursor: { next: 'next_1' },
          }),
          { status: 200 },
        ),
      )

      const result = await new OpenCodeClient('/api/opencode', '/repo').listSessionsPage({ limit: 10 })

      expect(result.nextCursor).toBe('next_1')
    })

    it('uses Untitled Session for empty title', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'ses_2',
                projectID: 'proj_2',
                title: '',
                time: { created: 1000, updated: 2000 },
              },
            ],
          }),
          { status: 200 },
        ),
      )

      const result = await new OpenCodeClient('/api/opencode', '/repo').listSessionsPage()

      expect(result.items[0].title).toBe('Untitled Session')
    })

    it('works without directory set', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'ses_3',
                projectID: 'proj_3',
                title: 'No Dir',
                time: { created: 1000, updated: 2000 },
              },
            ],
          }),
          { status: 200 },
        ),
      )

      const result = await new OpenCodeClient('/api/opencode').listSessionsPage({ limit: 5 })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost/api/opencode/api/session?limit=5',
        expect.any(Object),
      )
      expect(result.items[0].directory).toBe('')
    })
  })
})
