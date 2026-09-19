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

async function renderSandbox() {
  const user = userEvent.setup()
  render(<SandboxSettings />)
  await user.click(screen.getByRole('button', { name: /^Sandbox/ }))
  return user
}

describe('SandboxSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the controls collapsed until the disclosure is expanded', async () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    const user = userEvent.setup()
    render(<SandboxSettings />)

    const header = screen.getByRole('button', { name: /^Sandbox/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    const content = document.getElementById(header.getAttribute('aria-controls') ?? '')
    expect(content).toHaveClass('hidden')

    await user.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(content).toHaveClass('block')
    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeInTheDocument()
  })

  it('reflects the persisted sandbox preference', async () => {
    mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeChecked()
  })

  it('writes only the sandbox preference when toggled and shows the restart notice', async () => {
    const { updateSettingsAsync } = mockUseSettings()
    mockHealth({ available: true, enforced: false }, true)

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: false } })
    expect(screen.getByText('Restart the OpenCode server to apply sandbox changes.')).toBeInTheDocument()
  })

  it('disables the switch with a visible reason when microVMs are unavailable', async () => {
    mockUseSettings()
    mockHealth({ available: false, enforced: false, reason: 'KVM is not available on this host' })

    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()
  })

  it('still allows disabling an already-enabled preference when microVMs become unavailable', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: false, enforced: false, reason: 'KVM is not available on this host' })

    const user = await renderSandbox()

    const toggle = screen.getByRole('switch', { name: 'Toggle sandbox' })
    expect(toggle).toBeChecked()
    expect(toggle).not.toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()

    await user.click(toggle)

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: false, gitCredentials: false } })
  })

  it('disables the switch while sandbox availability has not been reported', async () => {
    mockUseSettings()
    vi.mocked(useServerHealth).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
      rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    } as ReturnType<typeof useServerHealth>)

    await renderSandbox()

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
    mockUseSettings({ updateSettingsAsync: vi.fn().mockRejectedValue(new Error('failed')) })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith('Failed to update sandbox preference')
  })

  it('shows the backend error when enabling sandboxing is rejected', async () => {
    mockUseSettings({
      updateSettingsAsync: vi.fn().mockRejectedValue(
        new FetchError('Cannot enable sandboxing: process identity attestation is unavailable', 400),
      ),
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith(
      'Cannot enable sandboxing: process identity attestation is unavailable',
    )
  })

  it('preserves the git credential preference when the sandbox toggle changes', async () => {
    const { updateSettingsAsync } = mockUseSettings({
      preferences: { sandbox: { enabled: false, gitCredentials: true } },
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: true } })
  })

  it('enables git credential forwarding without changing the sandbox preference', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, gitCredentials: true } })
  })

  it('disables the git credential switch while sandboxing is off', async () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' })).toBeDisabled()
  })
})
