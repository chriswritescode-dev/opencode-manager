import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerToolsMenu } from './ComposerToolsMenu'
import { renderWithProviders } from '@/test/render'
import { makeSettingsResponse } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import { SetSessionPermissionModeRequestSchema } from '@opencode-manager/shared/schemas'
import type { SessionPermissionModeState, SessionSandboxState } from '@opencode-manager/shared/schemas'

const basePermissionState: SessionPermissionModeState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  mode: 'ask',
  lockedReason: null,
}

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

interface MenuFixture {
  permission?: Partial<SessionPermissionModeState>
  sandbox?: Partial<SessionSandboxState>
  sandboxError?: { status: number, message: string }
  goalArmed?: boolean
  goalDisabled?: boolean
  goalLabel?: string
  sessionID?: string
  remote?: boolean
}

async function renderMenu(fixture: MenuFixture = {}) {
  const user = userEvent.setup()
  const sessionID = fixture.sessionID ?? 'ses_1'
  const permissionState = { ...basePermissionState, sessionId: sessionID, rootSessionId: sessionID, ...fixture.permission }
  const sandboxState = { ...baseSandboxState, sessionId: sessionID, rootSessionId: sessionID, ...fixture.sandbox }
  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: `/api/session-permission-modes/${sessionID}`,
      respond: () => ({ json: permissionState }),
    },
    {
      method: 'PUT',
      path: `/api/session-permission-modes/${sessionID}`,
      respond: (request) => {
        const parsed = SetSessionPermissionModeRequestSchema.safeParse(request.body)
        return { json: { ...permissionState, mode: parsed.success ? parsed.data.mode : 'ask' } }
      },
    },
    {
      method: 'GET',
      path: `/api/session-sandbox/${sessionID}`,
      respond: () => ({ json: sandboxState }),
    },
    {
      method: 'PUT',
      path: `/api/session-sandbox/${sessionID}`,
      respond: () => {
        if (fixture.sandboxError) {
          return { status: fixture.sandboxError.status, json: { error: fixture.sandboxError.message } }
        }
        return { json: sandboxState }
      },
    },
    { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse() }) },
  ]
  const props = {
    sessionID,
    directory: '/repo',
    goalArmed: fixture.goalArmed ?? false,
    goalDisabled: fixture.goalDisabled ?? false,
    goalLabel: fixture.goalLabel ?? 'Goal mode: the next message becomes the objective',
    onToggleGoal: vi.fn(),
    onAttachFile: vi.fn(),
  }
  const options = { auth: false, theme: false, toaster: false, fetchRoutes: routes } as const
  const result = fixture.remote
    ? renderWithProviders(<ComposerToolsMenu {...props} />, { ...options, serverId: 'srv_remote' })
    : renderWithProviders(<ComposerToolsMenu {...props} />, options)
  const scopeSuffix = fixture.remote ? ['srv_remote'] : []
  await waitFor(() => {
    expect(result.queryClient.getQueryData(['session-permission-mode', sessionID, ...scopeSuffix])).toBeDefined()
  })
  if (!fixture.remote) {
    await waitFor(() => expect(result.queryClient.getQueryData(['session-sandbox', sessionID])).toBeDefined())
  }
  return { ...result, ...props, user, sessionID }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Composer options' }))
}

describe('ComposerToolsMenu', () => {
  it('does not highlight the trigger when no tool is active', async () => {
    const { user } = await renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).not.toHaveClass('bg-highlight')
    await openMenu(user)
    expect(await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })).toHaveAttribute('aria-checked', 'false')
  })

  it.each([
    ['permissions accept everything', { permission: { mode: 'auto' } }],
    ['goal mode is armed', { goalArmed: true }],
    ['commands are sandboxed', { sandbox: { sandboxed: true } }],
  ] satisfies Array<[string, MenuFixture]>)('highlights the trigger while %s', async (_case, fixture) => {
    await renderMenu(fixture)

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('switches permissions to accept everything', async () => {
    const { user, fetchFake, sessionID } = await renderMenu()
    await openMenu(user)

    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })
    await user.click(item)

    expect(fetchFake.lastRequest('PUT', `/api/session-permission-modes/${sessionID}`)?.body).toMatchObject({
      directory: '/repo',
      mode: 'auto',
    })
  })

  it('offers permission and goal controls on a remote server without sandbox controls', async () => {
    const { user } = await renderMenu({ remote: true })
    await openMenu(user)

    expect(await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Goal mode/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: /Sandbox commands/ })).not.toBeInTheDocument()
  })

  it('shows why permissions cannot be changed', async () => {
    const { user } = await renderMenu({ permission: { lockedReason: 'child' } })
    await openMenu(user)

    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
  })

  it('shows the sandbox item checked while commands are sandboxed', async () => {
    const { user } = await renderMenu({ sandbox: { sandboxed: true } })
    await openMenu(user)

    expect(await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles sandboxing through the sandbox endpoint', async () => {
    const { user, fetchFake, sessionID } = await renderMenu()
    await openMenu(user)

    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)

    expect(fetchFake.lastRequest('PUT', `/api/session-sandbox/${sessionID}`)?.body).toMatchObject({ sandboxed: true })
  })

  it('hides the sandbox item when sandboxing is unavailable', async () => {
    const { user } = await renderMenu({ sandbox: { available: false } })
    await openMenu(user)

    expect(screen.queryByRole('menuitemcheckbox', { name: /Sandbox commands/ })).not.toBeInTheDocument()
  })

  it('shows why sandboxing cannot be changed', async () => {
    const { user } = await renderMenu({ sandbox: { lockedReason: 'child' } })
    await openMenu(user)

    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
  })

  it('toggles goal mode', async () => {
    const { user, onToggleGoal } = await renderMenu()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ }))

    expect(onToggleGoal).toHaveBeenCalledTimes(1)
  })

  it('shows why goal mode is unavailable', async () => {
    const { user } = await renderMenu({ goalDisabled: true, goalLabel: 'A goal is already active for this session' })
    await openMenu(user)

    const item = await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('A goal is already active for this session')
  })

  it('opens the file picker', async () => {
    const { user, onAttachFile } = await renderMenu()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Attach image or PDF' }))

    expect(onAttachFile).toHaveBeenCalledTimes(1)
  })

  it('uses the 44px control size for the trigger', async () => {
    await renderMenu()

    const trigger = await screen.findByRole('button', { name: 'Composer options' })
    expect(trigger).toHaveClass('size-11', 'p-0')
    expect(trigger).not.toHaveClass('p-2')
  })
})

describe('ComposerToolsMenu sandbox resources', () => {
  async function openResources(fixture: MenuFixture) {
    const result = await renderMenu({ ...fixture, sandbox: { sandboxed: true, ...fixture.sandbox } })
    await openMenu(result.user)
    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })
    await result.user.click(item)
    await screen.findByRole('dialog')
    return result
  }

  it('hides the resources item when the session is not sandboxed', async () => {
    const { user } = await renderMenu({ sandbox: { sandboxed: false } })
    await openMenu(user)
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('hides the resources item for a child session', async () => {
    const { user } = await renderMenu({ sandbox: { sandboxed: true, lockedReason: 'child' } })
    await openMenu(user)
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('hides the resources item when sandboxing is unavailable', async () => {
    const { user } = await renderMenu({ sandbox: { sandboxed: true, available: false } })
    await openMenu(user)

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('shows the effective values with a custom marker when an override exists', async () => {
    const { user } = await renderMenu({
      sandbox: { sandboxed: true, resources: { cpus: 8, memoryMib: 2048 }, effectiveResources: { cpus: 8, memoryMib: 2048 } },
    })
    await openMenu(user)

    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })

    expect(item).toHaveTextContent('8 CPUs · 2 GiB · custom')
  })

  it('prefills the dialog from the override', async () => {
    await openResources({
      sandbox: { resources: { cpus: 8, memoryMib: 2048 }, effectiveResources: { cpus: 8, memoryMib: 2048 } },
    })

    expect(screen.getByLabelText('CPUs')).toHaveValue(8)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(2)
  })

  it('prefills the dialog from the effective values without an override', async () => {
    await openResources({ sandbox: { resources: null, effectiveResources: { cpus: 2, memoryMib: 4096 } } })

    expect(screen.getByLabelText('CPUs')).toHaveValue(2)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(4)
  })

  it('saves the entered resources', async () => {
    const { fetchFake, sessionID, user } = await openResources({
      sandbox: { resources: null, effectiveResources: { cpus: 2, memoryMib: 4096 } },
    })

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '4')
    const memory = screen.getByLabelText('Memory (GiB)')
    await user.clear(memory)
    await user.type(memory, '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetchFake.lastRequest('PUT', `/api/session-sandbox/${sessionID}`)?.body).toMatchObject({
      resources: { cpus: 4, memoryMib: 3072 },
    })
  })

  it('clears the override with Use defaults', async () => {
    const { fetchFake, sessionID, user } = await openResources({
      sandbox: { resources: { cpus: 8, memoryMib: 2048 }, effectiveResources: { cpus: 8, memoryMib: 2048 } },
    })

    await user.click(screen.getByRole('button', { name: 'Use defaults' }))

    expect(fetchFake.lastRequest('PUT', `/api/session-sandbox/${sessionID}`)?.body).toMatchObject({ resources: null })
  })

  it('shows the server error when saving resources fails', async () => {
    const { user } = await openResources({
      sandbox: { resources: null, effectiveResources: { cpus: 2, memoryMib: 4096 } },
      sandboxError: { status: 400, message: 'Requested resources exceed the host' },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Requested resources exceed the host')
  })
})
