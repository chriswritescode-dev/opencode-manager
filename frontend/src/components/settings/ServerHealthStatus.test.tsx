import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServerHealthStatus } from './ServerHealthStatus'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useOpenCodeServerActions } from '@/hooks/useOpenCodeServerActions'

vi.mock('@/hooks/useServerHealth')
vi.mock('@/hooks/useOpenCodeServerActions')
vi.mock('@/components/settings/RestartServerDialog', () => ({
  RestartServerDialog: () => null,
}))

const BLOCKED_REASON = 'Updating the OpenCode version is disabled while agent sandboxing is enabled'

function mockHealth(sandbox?: { available: boolean; enforced: boolean; reason?: string; msbVersion?: string }) {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { opencode: 'healthy', opencodeVersion: '1.18.16', sandbox },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  } as ReturnType<typeof useServerHealth>)
}

function mockActions(overrides: Partial<ReturnType<typeof useOpenCodeServerActions>> = {}) {
  vi.mocked(useOpenCodeServerActions).mockReturnValue({
    restartServerMutation: { isPending: false },
    upgradeOpenCodeMutation: { isPending: false },
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    activeSessionCount: 0,
    requestRestart: vi.fn(),
    confirmRestart: vi.fn(),
    performUpgrade: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useOpenCodeServerActions>)
}

describe('ServerHealthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActions()
  })

  it('keeps Update and Versions enabled when sandboxing is off', () => {
    mockHealth({ available: true, enforced: false })

    render(<ServerHealthStatus />)

    expect(screen.getByRole('button', { name: /Update/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Versions/i })).toBeEnabled()
  })

  it('disables Update but keeps Versions accessible when sandbox enforcement is on', () => {
    mockHealth({ available: true, enforced: true })

    render(<ServerHealthStatus />)

    const update = screen.getByRole('button', { name: /Update/i })
    const versions = screen.getByRole('button', { name: /Versions/i })
    expect(update).toBeDisabled()
    expect(update).toHaveAttribute('title', BLOCKED_REASON)
    expect(versions).toBeEnabled()
    expect(screen.getByText(/Agent sandboxing is on; Update is disabled and only verified versions can be installed\./)).toBeInTheDocument()
  })

  it('keeps Update and Versions enabled while enforcement is pending but not active', () => {
    mockHealth({ available: false, enforced: false, reason: 'KVM unavailable' })

    render(<ServerHealthStatus />)

    expect(screen.getByRole('button', { name: /Update/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Versions/i })).toBeEnabled()
  })

  it('does not invoke an upgrade while the Update button is disabled', async () => {
    const user = userEvent.setup()
    const performUpgrade = vi.fn()
    mockActions({ performUpgrade })
    mockHealth({ available: true, enforced: true })

    render(<ServerHealthStatus />)

    await user.click(screen.getByRole('button', { name: /Update/i }))

    expect(performUpgrade).not.toHaveBeenCalled()
  })

  it('opens the version dialog when Versions is clicked under enforcement', async () => {
    const user = userEvent.setup()
    const onOpenVersionDialog = vi.fn()
    mockHealth({ available: true, enforced: true })

    render(<ServerHealthStatus onOpenVersionDialog={onOpenVersionDialog} />)

    await user.click(screen.getByRole('button', { name: /Versions/i }))

    expect(onOpenVersionDialog).toHaveBeenCalled()
  })
})
