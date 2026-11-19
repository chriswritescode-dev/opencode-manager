import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useScheduleTarget } from '../useScheduleTarget'
import { renderHookWithProviders } from '@/test/render'
import { makeAssistantModeStatus, makeRepo } from '@/test/fixtures/api'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

describe('useScheduleTarget', () => {
  it('returns the assistant schedule target for the assistant repo', async () => {
    const status = makeAssistantModeStatus({ directory: '/abs/assistant', relativePath: 'repos/assistant' })
    const { result, fetchFake } = renderHookWithProviders(() => useScheduleTarget(0), {
      ...hookProviders,
      fetchRoutes: [{ method: 'GET', path: '/api/repos/0/assistant-mode', respond: () => ({ json: status }) }],
    })

    await waitFor(() => expect(result.current.scheduleTarget).toBeDefined())

    expect(result.current.scheduleTarget).toMatchObject({
      repoId: 0,
      kind: 'assistant',
      subtitle: 'Built-in assistant',
      fullPath: '/abs/assistant',
      backHref: '/assistant',
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(fetchFake.requests.map((request) => request.path)).toEqual(['/api/repos/0/assistant-mode'])
  })

  it('returns the repo schedule target for a repo id', async () => {
    const repo = makeRepo({ id: 5, localPath: 'repos/my-repo', fullPath: '/abs/repos/my-repo' })
    const { result, fetchFake } = renderHookWithProviders(() => useScheduleTarget(5), {
      ...hookProviders,
      fetchRoutes: [{ method: 'GET', path: '/api/repos/5', respond: () => ({ json: repo }) }],
    })

    await waitFor(() => expect(result.current.scheduleTarget).toBeDefined())

    expect(result.current.scheduleTarget).toMatchObject({
      repoId: 5,
      kind: 'repo',
      fullPath: '/abs/repos/my-repo',
      backHref: '/repos/5',
    })
    expect(fetchFake.requests.map((request) => request.path)).toEqual(['/api/repos/5'])
  })

  it('returns no target and fetches nothing without a repo id', () => {
    const { result, fetchFake } = renderHookWithProviders(() => useScheduleTarget(undefined), hookProviders)

    expect(result.current.scheduleTarget).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
    expect(fetchFake.requests).toHaveLength(0)
  })
})
