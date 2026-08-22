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

function mockHealth() {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { opencode: 'healthy', opencodeVersion: '1.18.16' },
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
    mockHealth()
    mockActions()
  })

  it('keeps Update and Versions enabled', () => {
    render(<ServerHealthStatus />)

    expect(screen.getByRole('button', { name: /Update/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Versions/i })).toBeEnabled()
  })

  it('invokes an upgrade when Update is clicked', async () => {
    const user = userEvent.setup()
    const performUpgrade = vi.fn()
    mockActions({ performUpgrade })

    render(<ServerHealthStatus />)

    await user.click(screen.getByRole('button', { name: /Update/i }))

    expect(performUpgrade).toHaveBeenCalled()
  })

  it('opens the version dialog when Versions is clicked', async () => {
    const user = userEvent.setup()
    const onOpenVersionDialog = vi.fn()

    render(<ServerHealthStatus onOpenVersionDialog={onOpenVersionDialog} />)

    await user.click(screen.getByRole('button', { name: /Versions/i }))

    expect(onOpenVersionDialog).toHaveBeenCalled()
  })
})
