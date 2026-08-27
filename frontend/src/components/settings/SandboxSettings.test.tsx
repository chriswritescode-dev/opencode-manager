import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SandboxSettings } from './SandboxSettings'
import { useSettings } from '@/hooks/useSettings'
import { useServerHealth } from '@/hooks/useServerHealth'
import { showToast } from '@/lib/toast'
import { FetchError } from '@/api/fetchWrapper'

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}))

function mockUseSettings(overrides: Partial<ReturnType<typeof useSettings>> = {}) {
  const updateSettingsAsync = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useSettings).mockReturnValue({
    settings: undefined,
    preferences: { sandbox: { enabled: false } },
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
    updateSettingsAsync,
    resetSettings: vi.fn(),
    isUpdating: false,
    isResetting: false,
    ...overrides,
  })
  return { updateSettingsAsync }
}

function mockHealth(sandbox?: { available: boolean; enforced: boolean; reason?: string; msbVersion?: string }, opencodeRestartPending = false) {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { opencode: 'healthy', opencodeRestartPending, sandbox },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  } as ReturnType<typeof useServerHealth>)
}

describe('SandboxSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reflects the persisted sandbox preference', () => {
    mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeChecked()
  })

  it('writes only the sandbox preference when toggled and shows the restart notice', async () => {
    const user = userEvent.setup()
    const { updateSettingsAsync } = mockUseSettings()
    mockHealth({ available: true, enforced: false }, true)

    render(<SandboxSettings />)

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: false } })
    expect(screen.getByText('Restart the OpenCode server to apply sandbox changes.')).toBeInTheDocument()
  })

  it('disables the switch with a visible reason when microVMs are unavailable', () => {
    mockUseSettings()
    mockHealth({ available: false, enforced: false, reason: 'KVM is not available on this host' })

    render(<SandboxSettings />)

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()
  })

  it('still allows disabling an already-enabled preference when microVMs become unavailable', async () => {
    const user = userEvent.setup()
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: false, enforced: false, reason: 'KVM is not available on this host' })

    render(<SandboxSettings />)

    const toggle = screen.getByRole('switch', { name: 'Toggle sandbox' })
    expect(toggle).toBeChecked()
    expect(toggle).not.toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()

    await user.click(toggle)

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: false, gitCredentials: false } })
  })

  it('disables the switch while sandbox availability has not been reported', () => {
    mockUseSettings()
    vi.mocked(useServerHealth).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
      rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    } as ReturnType<typeof useServerHealth>)

    render(<SandboxSettings />)

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeDisabled()
    expect(screen.getByText('Checking sandbox availability...')).toBeInTheDocument()
  })

  it('shows the reported msb version when present', () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false, msbVersion: '0.9.1' })

    render(<SandboxSettings />)

    expect(screen.getByText('msb 0.9.1')).toBeInTheDocument()
  })

  it('shows an error toast when saving the preference fails', async () => {
    const user = userEvent.setup()
    mockUseSettings({ updateSettingsAsync: vi.fn().mockRejectedValue(new Error('failed')) })
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith('Failed to update sandbox preference')
  })

  it('shows the backend error when enabling sandboxing is rejected', async () => {
    const user = userEvent.setup()
    mockUseSettings({
      updateSettingsAsync: vi.fn().mockRejectedValue(
        new FetchError('Cannot enable sandboxing: process identity attestation is unavailable', 400),
      ),
    })
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith(
      'Cannot enable sandboxing: process identity attestation is unavailable',
    )
  })

  it('preserves the git credential preference when the sandbox toggle changes', async () => {
    const user = userEvent.setup()
    const { updateSettingsAsync } = mockUseSettings({
      preferences: { sandbox: { enabled: false, gitCredentials: true } },
    })
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: true } })
  })

  it('enables git credential forwarding without changing the sandbox preference', async () => {
    const user = userEvent.setup()
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    await user.click(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: true } })
  })

  it('disables the git credential switch while sandboxing is off', () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    render(<SandboxSettings />)

    expect(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' })).toBeDisabled()
  })
})
