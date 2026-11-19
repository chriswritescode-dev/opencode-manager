import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLoadSkill } from '../useOpenCode'
import { renderHookWithProviders } from '@/test/render'

const skillRoute = '/api/opencode/api/experimental/session/ses_skill/skill'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

describe('useLoadSkill', () => {
  it('activates the skill for the session', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useLoadSkill('ses_skill'), {
      ...hookProviders,
      fetchRoutes: [{ method: 'POST', path: skillRoute, respond: () => ({ status: 204 }) }],
    })

    await act(async () => {
      await result.current.mutateAsync({ skillName: 'my-skill' })
    })

    expect(fetchFake.lastRequest('POST', skillRoute)?.body).toEqual({ id: 'my-skill' })
  })

  it('rejects without a request when there is no active session', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useLoadSkill(undefined), hookProviders)

    await act(async () => {
      await expect(result.current.mutateAsync({ skillName: 'my-skill' })).rejects.toThrow('No active session')
    })

    expect(fetchFake.requests).toHaveLength(0)
    expect(await screen.findByText('No active session')).toBeInTheDocument()
  })

  it.each([
    { title: 'a server error', route: () => ({ status: 500, json: { error: 'Command failed' } }), message: 'UnexpectedStatus: 500' },
    {
      title: 'a network failure',
      route: () => {
        throw new Error('network down')
      },
      message: 'Transport: network down',
    },
  ])('shows the failure message for $title', async ({ route, message }) => {
    const { result } = renderHookWithProviders(() => useLoadSkill('ses_skill'), {
      ...hookProviders,
      fetchRoutes: [{ method: 'POST', path: skillRoute, respond: route }],
    })

    await act(async () => {
      await expect(result.current.mutateAsync({ skillName: 'my-skill' })).rejects.toThrow(message)
    })

    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
