import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSandboxMenu } from './SessionSandboxMenu'
import { useSessionSandbox, useSetSessionSandbox } from '@/hooks/useSessionSandbox'
import type { SessionSandboxState } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionSandbox')

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

function renderMenu() {
  render(<SessionSandboxMenu sessionID="ses_1" />)
}

describe('SessionSandboxMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSandbox()
  })

  it('renders nothing when sandboxing is unavailable', () => {
    mockSandbox({ available: false })
    renderMenu()

    expect(screen.queryByRole('button', { name: /Sandbox:/ })).not.toBeInTheDocument()
  })

  it('reflects the off state in the trigger label', () => {
    mockSandbox({ sandboxed: false })
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Sandbox: off' })
    expect(trigger).not.toHaveClass('bg-highlight')
  })

  it('reflects the on state in the trigger label', () => {
    mockSandbox({ sandboxed: true })
    renderMenu()

    expect(screen.getByRole('button', { name: 'Sandbox: on' })).toHaveClass('bg-highlight')
  })

  it('enables sandboxing through the checkbox item', async () => {
    const user = userEvent.setup()
    const { mutate } = mockSandbox({ sandboxed: false })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Sandbox: off' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)

    expect(mutate).toHaveBeenCalledWith({ sandboxed: true })
  })

  it('disables sandboxing through the checkbox item', async () => {
    const user = userEvent.setup()
    const { mutate } = mockSandbox({ sandboxed: true })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Sandbox: on' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })
    expect(item).toHaveAttribute('aria-checked', 'true')
    await user.click(item)

    expect(mutate).toHaveBeenCalledWith({ sandboxed: false })
  })

  it('hides the resources item when the session is not sandboxed', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: false })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Sandbox: off' }))
    await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })

  it('opens the resources dialog from the menu item', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: true, effectiveResources: { cpus: 2, memoryMib: 4096 } })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Sandbox: on' }))
    const item = await screen.findByRole('menuitem', { name: /Sandbox resources/ })
    await user.click(item)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('CPUs')).toHaveValue(2)
  })

  it('disables the checkbox and explains inheritance for a child session', async () => {
    const user = userEvent.setup()
    mockSandbox({ sandboxed: true, lockedReason: 'child' })
    renderMenu()

    await user.click(screen.getByRole('button', { name: /Inherited from parent session/ }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Sandbox commands/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
    expect(screen.queryByRole('menuitem', { name: /Sandbox resources/ })).not.toBeInTheDocument()
  })
})
