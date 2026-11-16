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
  lockedReason: null,
  available: true,
}

interface MenuFixture {
  permission?: Partial<SessionPermissionModeState>
  sandbox?: Partial<SessionSandboxState>
  goalArmed?: boolean
  goalDisabled?: boolean
  goalLabel?: string
  sessionID?: string
  repoId?: number
  remote?: boolean
}

async function renderMenu(fixture: MenuFixture = {}) {
  const user = userEvent.setup()
  const sessionID = fixture.sessionID ?? 'ses_1'
  const repoId = 'repoId' in fixture ? fixture.repoId : fixture.remote ? undefined : 1
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
      respond: () => ({ json: sandboxState }),
    },
    { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse() }) },
    {
      method: 'GET',
      path: '/api/repos/:repoId/sandbox/resources',
      respond: () => ({
        json: { override: null, effective: { cpus: 2, memoryMib: 4096 }, running: null },
      }),
    },
    {
      method: 'PUT',
      path: '/api/repos/:repoId/sandbox/resources',
      respond: () => ({
        json: { override: null, effective: { cpus: 2, memoryMib: 4096 }, running: null },
      }),
    },
    { method: 'POST', path: '/api/repos/:repoId/sandbox/restart', respond: () => ({ status: 204 }) },
  ]
  const props = {
    sessionID,
    directory: '/repo',
    repoId,
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
  async function openResources(fixture: MenuFixture = {}) {
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

  it('hides the resources item when the repository id is unknown', async () => {
    const { user } = await renderMenu({ repoId: undefined, sandbox: { sandboxed: true } })
    await openMenu(user)
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('opens the repository resources dialog for a sandboxed session', async () => {
    await openResources()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByLabelText('CPUs')).toHaveValue(2)
  })

  it('saves the entered resources to the repository', async () => {
    const { fetchFake, user } = await openResources()

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(2))
    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '4')
    const memory = screen.getByLabelText('Memory (GiB)')
    await user.clear(memory)
    await user.type(memory, '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', '/api/repos/1/sandbox/resources')?.body).toEqual({
        cpus: 4,
        memoryMib: 3072,
      }),
    )
  })

  it('restarts the repository sandbox from the dialog', async () => {
    const { fetchFake, user } = await openResources()

    await screen.findByRole('button', { name: 'Restart sandbox now' })
    await user.click(screen.getByRole('button', { name: 'Restart sandbox now' }))

    await waitFor(() =>
      expect(fetchFake.findRequests('POST', '/api/repos/1/sandbox/restart')).toHaveLength(1),
    )
  })
})
