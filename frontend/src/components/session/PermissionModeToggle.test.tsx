import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SetSessionPermissionModeRequestSchema,
  type SessionPermissionModeState,
} from '@opencode-manager/shared/schemas'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { PermissionModeToggle } from './PermissionModeToggle'

const baseState: SessionPermissionModeState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  mode: 'ask',
  lockedReason: null,
}

function renderToggle(initial: SessionPermissionModeState, getRespond?: FetchRoute['respond']) {
  let state = initial
  const modeUrl = `/api/session-permission-modes/${initial.sessionId}`

  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: modeUrl,
      respond: getRespond ?? (() => ({ json: state })),
    },
    {
      method: 'PUT',
      path: modeUrl,
      respond: (request) => {
        const parsed = SetSessionPermissionModeRequestSchema.safeParse(request.body)
        if (parsed.success) state = { ...state, mode: parsed.data.mode }
        return { json: state }
      },
    },
  ]

  return renderWithProviders(<PermissionModeToggle sessionID={initial.sessionId} directory="/repo" />, {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    serverId: 'srv_remote',
    fetchRoutes: routes,
  })
}

describe('PermissionModeToggle', () => {
  it.each([
    ['ask', 'Permissions: follow configured rules', 'auto'],
    ['auto', 'Permissions: auto-accept all', 'ask'],
  ] as const)('switches a loaded %s mode to %s through the current server', async (mode, label, nextMode) => {
    const user = userEvent.setup()
    const { fetchFake } = renderToggle({ ...baseState, mode })

    await user.click(await screen.findByRole('button', { name: label }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', '/api/session-permission-modes/ses_1')?.body).toEqual({
        directory: '/repo',
        mode: nextMode,
        serverId: 'srv_remote',
      }),
    )
  })

  it.each([
    ['child', 'Inherited from parent session'],
    ['schedule', "Scheduled runs use the schedule's permission configuration"],
  ] as const)('is disabled and labelled for %s-locked sessions', async (lockedReason, label) => {
    renderToggle({ ...baseState, mode: 'auto', lockedReason })

    expect(await screen.findByRole('button', { name: label })).toBeDisabled()
  })

  it('stays disabled and skips the write while the mode read is pending', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderToggle(
      baseState,
      () => new Promise<FetchRouteResult>(() => undefined),
    )

    const button = screen.getByRole('button', { name: 'Permissions: loading' })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(fetchFake.findRequests('PUT', '/api/session-permission-modes/ses_1')).toHaveLength(0)
  })

  it('stays disabled and reports unavailable when the mode read fails', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderToggle(baseState, () => ({ status: 500, json: { error: 'boom' } }))

    const button = await screen.findByRole('button', { name: 'Permissions: unavailable' })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(fetchFake.findRequests('PUT', '/api/session-permission-modes/ses_1')).toHaveLength(0)
  })
})
