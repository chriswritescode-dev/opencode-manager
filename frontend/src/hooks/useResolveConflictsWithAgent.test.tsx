import { act, screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useResolveConflictsWithAgent } from './useResolveConflictsWithAgent'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  initialEntries: ['/repos/1'],
} as const

const createdSession = makeSession({ id: 'ses_new', location: { directory: '/abs/repos/my-repo' } })

const promptRoute: FetchRoute = {
  method: 'POST',
  path: '/api/opencode/api/session/ses_new/prompt',
  respond: () => ({
    json: {
      data: {
        id: 'inbox_1',
        sessionID: 'ses_new',
        time: { created: 1 },
        type: 'user',
        payload: { text: 'prompt' },
        delivery: 'queue',
      },
    },
  }),
}

function renderResolve(createRespond: FetchRoute['respond']) {
  return renderHookWithProviders(
    () => ({
      resolve: useResolveConflictsWithAgent({ id: 1, fullPath: '/abs/repos/my-repo' }),
      location: useLocation(),
    }),
    {
      ...hookProviders,
      fetchRoutes: [
        { method: 'POST', path: '/api/opencode/api/session', respond: createRespond },
        promptRoute,
      ],
    },
  )
}

describe('useResolveConflictsWithAgent', () => {
  it('creates one session in the repo directory, sends one prompt, and navigates to it', async () => {
    const { result, fetchFake } = renderResolve(() => ({ json: { data: createdSession } }))

    await act(async () => {
      await result.current.resolve.mutateAsync({
        operation: { kind: 'rebase', conflictedFiles: ['src/a.ts'] },
        branch: 'main',
      })
    })

    expect(fetchFake.findRequests('POST', '/api/opencode/api/session')).toHaveLength(1)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session')?.body).toEqual({
      title: 'Resolve rebase conflicts',
      location: { directory: '/abs/repos/my-repo' },
    })
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/ses_new/prompt')).toHaveLength(1)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_new/prompt')?.body).toMatchObject({
      text: expect.stringContaining('GIT_EDITOR=true git rebase --continue'),
    })
    await waitFor(() => expect(result.current.location.pathname).toBe('/repos/1/sessions/ses_new'))
  })

  it('shows an error without navigating when creating the session fails', async () => {
    const { result } = renderResolve(() => ({ status: 400, json: { message: 'gateway timeout' } }))

    await act(async () => {
      await expect(
        result.current.resolve.mutateAsync({
          operation: { kind: 'merge', conflictedFiles: ['file.txt'] },
          branch: 'main',
        }),
      ).rejects.toThrow('gateway timeout')
    })

    expect(await screen.findByText('Could not start conflict resolution: gateway timeout')).toBeInTheDocument()
    expect(result.current.location.pathname).toBe('/repos/1')
  })
})
