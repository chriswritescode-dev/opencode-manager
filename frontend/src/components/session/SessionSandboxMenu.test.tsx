import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SetSessionSandboxRequestSchema,
  type SessionSandboxState,
} from '@opencode-manager/shared/schemas'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { SessionSandboxMenu } from './SessionSandboxMenu'

const baseSandboxState: SessionSandboxState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  sandboxed: false,
  source: 'default',
  resources: null,
  effectiveResources: { cpus: 2, memoryMib: 4096 },
  lockedReason: null,
  available: true,
}

function renderMenu(overrides: Partial<SessionSandboxState> = {}, putRespond?: FetchRoute['respond']) {
  let state: SessionSandboxState = { ...baseSandboxState, ...overrides }
  const sandboxUrl = '/api/session-sandbox/ses_1'

  const routes: FetchRoute[] = [
    { method: 'GET', path: sandboxUrl, respond: () => ({ json: state }) },
    {
      method: 'PUT',
      path: sandboxUrl,
      respond: (request) => {
        if (putRespond) return putRespond(request)
        const parsed = SetSessionSandboxRequestSchema.safeParse(request.body)
        if (parsed.success) state = { ...state, ...parsed.data }
        return { json: state }
      },
    },
  ]

  return renderWithProviders(<SessionSandboxMenu sessionID="ses_1" />, {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    fetchRoutes: routes,
  })
}

describe('SessionSandboxMenu', () => {
  it('renders nothing when sandboxing is unavailable', async () => {
    renderMenu({ available: false })

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Sandbox:/ })).not.toBeInTheDocument(),
    )
  })

  it.each([
    [false, 'Sandbox: off'],
    [true, 'Sandbox: on'],
  ] as const)('reflects the sandboxed=%s state in the trigger', async (sandboxed, label) => {
    renderMenu({ sandboxed })

    const trigger = await screen.findByRole('button', { name: label })
    if (sandboxed) expect(trigger).toHaveClass('bg-highlight')
    else expect(trigger).not.toHaveClass('bg-highlight')
  })

  it.each([
    [false, 'Sandbox: off', 'false', { sandboxed: true }, 'Sandbox: on'],
    [true, 'Sandbox: on', 'true', { sandboxed: false }, 'Sandbox: off'],
  ] as const)(
    'toggles sandboxing from the %s state through the checkbox item',
    async (sandboxed, label, checked, expectedBody, nextLabel) => {
      const user = userEvent.setup()
      const { fetchFake } = renderMenu({ sandboxed })

      await user.click(await screen.findByRole('button', { name: label }))
      const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })
      expect(item).toHaveAttribute('aria-checked', checked)
      await user.click(item)

      await waitFor(() =>
        expect(fetchFake.lastRequest('PUT', '/api/session-sandbox/ses_1')?.body).toEqual(expectedBody),
      )
      expect(await screen.findByRole('button', { name: nextLabel })).toBeInTheDocument()
    },
  )

  it('hides the resources item when the session is not sandboxed', async () => {
    const user = userEvent.setup()
    renderMenu({ sandboxed: false })

    await user.click(await screen.findByRole('button', { name: 'Sandbox: off' }))
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('opens the resources dialog from the menu item', async () => {
    const user = userEvent.setup()
    renderMenu({ sandboxed: true, effectiveResources: { cpus: 2, memoryMib: 4096 } })

    await user.click(await screen.findByRole('button', { name: 'Sandbox: on' }))
    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })
    await user.click(item)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('CPUs')).toHaveValue(2)
  })

  it('disables the checkbox and explains inheritance for a child session', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderMenu({ sandboxed: true, lockedReason: 'child' })

    await user.click(await screen.findByRole('button', { name: /Inherited from parent session/ }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
    expect(fetchFake.findRequests('PUT', '/api/session-sandbox/ses_1')).toHaveLength(0)
  })

  it('keeps the trigger label when the toggle write fails', async () => {
    const user = userEvent.setup()
    renderMenu({ sandboxed: false }, () => new Promise<FetchRouteResult>(() => undefined))

    await user.click(await screen.findByRole('button', { name: 'Sandbox: off' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sandbox: off' })).toBeInTheDocument())
  })
})
