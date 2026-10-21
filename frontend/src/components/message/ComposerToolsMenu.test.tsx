import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerToolsMenu } from './ComposerToolsMenu'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { useSessionPermissionMode, useSetSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import { useSessionSandbox, useSetSessionSandbox } from '@/hooks/useSessionSandbox'
import { FetchError } from '@/api/fetchWrapper'
import type { SessionPermissionModeState, SessionSandboxState } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionPermissionMode')
vi.mock('@/hooks/useSessionSandbox')

const baseState: SessionPermissionModeState = {
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

function mockPermissionMode(state: Partial<SessionPermissionModeState> = {}, mutate = vi.fn()) {
  vi.mocked(useSessionPermissionMode).mockReturnValue({
    data: { ...baseState, ...state },
    isError: false,
  } as ReturnType<typeof useSessionPermissionMode>)
  vi.mocked(useSetSessionPermissionMode).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetSessionPermissionMode>)
  return mutate
}

function mockSandbox(
  state: Partial<SessionSandboxState> = {},
  mutateAsync = vi.fn().mockResolvedValue(undefined),
) {
  const mutate = vi.fn()
  vi.mocked(useSessionSandbox).mockReturnValue({
    data: { ...baseSandboxState, ...state },
    isError: false,
  } as ReturnType<typeof useSessionSandbox>)
  vi.mocked(useSetSessionSandbox).mockReturnValue({
    mutate,
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useSetSessionSandbox>)
  return { mutate, mutateAsync }
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof ComposerToolsMenu>> = {}) {
  const props = {
    sessionID: 'ses_1',
    directory: '/repo',
    goalArmed: false,
    goalDisabled: false,
    goalLabel: 'Goal mode: the next message becomes the objective',
    onToggleGoal: vi.fn(),
    onAttachFile: vi.fn(),
    ...overrides,
  }
  render(<ComposerToolsMenu {...props} />)
  return props
}

function renderRemoteMenu(overrides: Partial<React.ComponentProps<typeof ComposerToolsMenu>> = {}) {
  const props = {
    sessionID: 'ses_remote',
    directory: '/remote/repo',
    goalArmed: false,
    goalDisabled: false,
    goalLabel: 'Goal mode: the next message becomes the objective',
    onToggleGoal: vi.fn(),
    onAttachFile: vi.fn(),
    ...overrides,
  }
  render(
    <OpenCodeServerProvider serverId="srv_remote">
      <ComposerToolsMenu {...props} />
    </OpenCodeServerProvider>,
  )
  return props
}

describe('ComposerToolsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSandbox()
  })

  it('does not highlight the trigger when no tool is active', () => {
    mockPermissionMode()
    renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).not.toHaveClass('bg-highlight')
  })

  it('highlights the trigger while permissions accept everything', () => {
    mockPermissionMode({ mode: 'auto' })
    renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('highlights the trigger while goal mode is armed', () => {
    mockPermissionMode()
    renderMenu({ goalArmed: true })

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('switches permissions to accept everything', async () => {
    const user = userEvent.setup()
    const mutate = mockPermissionMode()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)

    expect(mutate).toHaveBeenCalledWith({ directory: '/repo', mode: 'auto' })
  })

  it('offers permission and goal controls on a remote server without sandbox controls', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    renderRemoteMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))

    expect(await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Goal mode/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: /Sandbox commands/ })).not.toBeInTheDocument()
  })

  it('shows why permissions cannot be changed', async () => {
    const user = userEvent.setup()
    mockPermissionMode({ lockedReason: 'child' })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
  })

  it('highlights the trigger while commands are sandboxed', () => {
    mockPermissionMode()
    mockSandbox({ sandboxed: true })
    renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('shows the sandbox item checked while commands are sandboxed', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    mockSandbox({ sandboxed: true })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(item).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles sandboxing via the sandbox endpoint', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const { mutate } = mockSandbox()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)

    expect(mutate).toHaveBeenCalledWith({ sandboxed: true })
  })

  it('hides the sandbox item when sandboxing is unavailable', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    mockSandbox({ available: false })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })

    expect(screen.queryByRole('menuitemcheckbox', { name: /Sandbox commands/ })).not.toBeInTheDocument()
  })

  it('shows why sandboxing cannot be changed', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    mockSandbox({ lockedReason: 'child' })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
  })

  it('toggles goal mode', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const props = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ }))

    expect(props.onToggleGoal).toHaveBeenCalledTimes(1)
  })

  it('shows why goal mode is unavailable', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    renderMenu({ goalDisabled: true, goalLabel: 'A goal is already active for this session' })

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('A goal is already active for this session')
  })

  it('opens the file picker', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const props = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Attach image or PDF' }))

    expect(props.onAttachFile).toHaveBeenCalledTimes(1)
  })

  it('uses the 44px control size for the trigger', () => {
    mockPermissionMode()
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Composer options' })
    expect(trigger).toHaveClass('size-11', 'p-0')
    expect(trigger).not.toHaveClass('p-2')
  })
})

describe('ComposerToolsMenu sandbox resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissionMode()
    mockSandbox()
  })

  async function openResources(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })
    await user.click(item)
    await screen.findByRole('dialog')
  }

  it('hides the resources item when the session is not sandboxed', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: false })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('hides the resources item for a child session', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: true, lockedReason: 'child' })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('hides the resources item when sandboxing is unavailable', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: true, available: false })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('shows the effective values with a custom marker when an override exists', async () => {
    const user = userEvent.setup()
    mockSandbox({
      sandboxed: true,
      resources: { cpus: 8, memoryMib: 2048 },
      effectiveResources: { cpus: 8, memoryMib: 2048 },
    })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })

    expect(item).toHaveTextContent('8 CPUs · 2 GiB · custom')
  })

  it('prefills the dialog from the override', async () => {
    const user = userEvent.setup()
    mockSandbox({
      sandboxed: true,
      resources: { cpus: 8, memoryMib: 2048 },
      effectiveResources: { cpus: 8, memoryMib: 2048 },
    })
    renderMenu()

    await openResources(user)

    expect(screen.getByLabelText('CPUs')).toHaveValue(8)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(2)
  })

  it('prefills the dialog from the effective values without an override', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: true, resources: null, effectiveResources: { cpus: 2, memoryMib: 4096 } })
    renderMenu()

    await openResources(user)

    expect(screen.getByLabelText('CPUs')).toHaveValue(2)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(4)
  })

  it('saves the entered resources', async () => {
    const user = userEvent.setup()
    const { mutateAsync } = mockSandbox({
      sandboxed: true,
      resources: null,
      effectiveResources: { cpus: 2, memoryMib: 4096 },
    })
    renderMenu()

    await openResources(user)
    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '4')
    const memory = screen.getByLabelText('Memory (GiB)')
    await user.clear(memory)
    await user.type(memory, '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mutateAsync).toHaveBeenCalledWith({ resources: { cpus: 4, memoryMib: 3072 } })
  })

  it('clears the override with Use defaults', async () => {
    const user = userEvent.setup()
    const { mutateAsync } = mockSandbox({
      sandboxed: true,
      resources: { cpus: 8, memoryMib: 2048 },
      effectiveResources: { cpus: 8, memoryMib: 2048 },
    })
    renderMenu()

    await openResources(user)
    await user.click(screen.getByRole('button', { name: 'Use defaults' }))

    expect(mutateAsync).toHaveBeenCalledWith({ resources: null })
  })

  it('shows the server error when saving resources fails', async () => {
    const user = userEvent.setup()
    mockSandbox(
      { sandboxed: true, resources: null, effectiveResources: { cpus: 2, memoryMib: 4096 } },
      vi.fn().mockRejectedValue(new FetchError('Requested resources exceed the host', 400)),
    )
    renderMenu()

    await openResources(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Requested resources exceed the host')
  })
})
