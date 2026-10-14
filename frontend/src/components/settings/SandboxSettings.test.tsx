import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SandboxSettings } from './SandboxSettings'
import { useSettings } from '@/hooks/useSettings'
import { useServerHealth } from '@/hooks/useServerHealth'
import { showToast } from '@/lib/toast'
import { FetchError } from '@/api/fetchWrapper'
import type { UserPreferences } from '@/api/types/settings'
import { createUseSettingsMock } from '@/test/test-utils'

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}))

function mockUseSettings(overrides: Partial<ReturnType<typeof useSettings>> = {}) {
  const updateSettingsAsync = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({
      preferences: { sandbox: { enabled: false } } as UserPreferences,
      updateSettingsAsync,
      ...overrides,
    }),
  )
  return { updateSettingsAsync }
}

function mockHealth(sandbox?: { available: boolean; enforced: boolean; reason?: string; msbVersion?: string }, opencodeRestartPending = false) {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { opencode: 'healthy', opencodeRestartPending, sandbox },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: { enabled: true, gitCredentials: false, defaultForNewSessions: true },
    })
    expect(
      screen.getByText(
        'Restart the OpenCode server to apply changes to sandbox support or git credentials. Per-session sandbox toggles apply immediately.',
      ),
    ).toBeInTheDocument()
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

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: { enabled: false, gitCredentials: false, defaultForNewSessions: true },
    })
  })

  it('disables the switch while sandbox availability has not been reported', async () => {
    mockUseSettings()
    vi.mocked(useServerHealth).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
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

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: { enabled: true, gitCredentials: true, defaultForNewSessions: true },
    })
  })

  it('enables git credential forwarding without changing the sandbox preference', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: { enabled: true, gitCredentials: true, defaultForNewSessions: true },
    })
  })

  it('disables the git credential switch while sandboxing is off', async () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' })).toBeDisabled()
  })

  it('hides the default-for-new-sessions switch while sandboxing is off', async () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.queryByRole('switch', { name: 'Toggle sandbox for new sessions' })).not.toBeInTheDocument()
  })

  it('saves the default-for-new-sessions preference preserving other fields', async () => {
    const { updateSettingsAsync } = mockUseSettings({
      preferences: { sandbox: { enabled: true, gitCredentials: true, defaultForNewSessions: true } },
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox for new sessions' }))

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: { enabled: true, gitCredentials: true, defaultForNewSessions: false },
    })
  })

  it('reflects the persisted default-for-new-sessions preference', async () => {
    mockUseSettings({
      preferences: { sandbox: { enabled: true, gitCredentials: false, defaultForNewSessions: false } },
    })
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle sandbox for new sessions' })).not.toBeChecked()
  })

  it('renders the resource inputs when sandboxing is enabled', async () => {
    mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.getByLabelText('Default CPUs')).toBeInTheDocument()
    expect(screen.getByLabelText('Default memory (GiB)')).toBeInTheDocument()
    expect(screen.getByLabelText('Stop idle sandbox VMs after (minutes)')).toBeInTheDocument()
    expect(screen.getByLabelText('Max running sandbox VMs')).toBeInTheDocument()
  })

  it('hides the resource inputs while sandboxing is off', async () => {
    mockUseSettings()
    mockHealth({ available: true, enforced: false })

    await renderSandbox()

    expect(screen.queryByLabelText('Default CPUs')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Max running sandbox VMs')).not.toBeInTheDocument()
  })

  it('saves CPUs while preserving the other sandbox fields', async () => {
    const { updateSettingsAsync } = mockUseSettings({
      preferences: {
        sandbox: {
          enabled: true,
          gitCredentials: true,
          defaultForNewSessions: false,
          idleStopMinutes: 45,
          maxRunningVms: 6,
        },
      },
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    const cpus = screen.getByLabelText('Default CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')
    await user.tab()

    expect(updateSettingsAsync).toHaveBeenCalledWith({
      sandbox: {
        enabled: true,
        gitCredentials: true,
        defaultForNewSessions: false,
        idleStopMinutes: 45,
        maxRunningVms: 6,
        cpus: 8,
      },
    })
  })

  it('saves memory in MiB from the GiB input', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '2.5')
    await user.tab()

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, memoryMib: 2560 } })
  })

  it('omits CPUs when cleared to use the server default', async () => {
    const { updateSettingsAsync } = mockUseSettings({
      preferences: { sandbox: { enabled: true, cpus: 4, memoryMib: 4096 } },
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    await user.clear(screen.getByLabelText('Default CPUs'))
    await user.tab()

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, memoryMib: 4096 } })
  })

  it('omits memory when cleared to use the server default', async () => {
    const { updateSettingsAsync } = mockUseSettings({
      preferences: { sandbox: { enabled: true, cpus: 4, memoryMib: 4096 } },
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    await user.clear(screen.getByLabelText('Default memory (GiB)'))
    await user.tab()

    expect(updateSettingsAsync).toHaveBeenCalledWith({ sandbox: { enabled: true, cpus: 4 } })
  })

  it('rejects out-of-range CPUs, keeps the stored value, and warns', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true, cpus: 4 } } })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    const cpus = screen.getByLabelText('Default CPUs')
    await user.clear(cpus)
    await user.type(cpus, '999')
    await user.tab()

    expect(updateSettingsAsync).not.toHaveBeenCalled()
    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith('Default CPUs must be a whole number from 1 to 64')
    expect(screen.getByLabelText('Default CPUs')).toHaveValue(4)
  })

  it('rejects out-of-range memory and warns', async () => {
    const { updateSettingsAsync } = mockUseSettings({ preferences: { sandbox: { enabled: true } } })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '0.5')
    await user.tab()

    expect(updateSettingsAsync).not.toHaveBeenCalled()
    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith('Default memory must be between 1 and 1024 GiB')
  })

  it('shows the backend error when the resource preference is rejected', async () => {
    mockUseSettings({
      preferences: { sandbox: { enabled: true } },
      updateSettingsAsync: vi.fn().mockRejectedValue(new FetchError('Default memory exceeds the host memory', 400)),
    })
    mockHealth({ available: true, enforced: false })

    const user = await renderSandbox()
    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '64')
    await user.tab()

    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith('Default memory exceeds the host memory')
  })
})
