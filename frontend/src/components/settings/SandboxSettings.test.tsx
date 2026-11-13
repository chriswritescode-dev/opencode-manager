import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DEFAULT_SANDBOX_PREFERENCES,
  type SandboxPreferences,
} from '@opencode-manager/shared/schemas'
import { SandboxSettings } from './SandboxSettings'
import { renderWithProviders } from '@/test/render'
import { makeHealthResponse, makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { HealthResponse } from '@/hooks/useServerHealth'

interface SandboxRenderOptions {
  sandbox?: Partial<SandboxPreferences>
  health?: Partial<HealthResponse>
  patch?: () => FetchRouteResult | Promise<FetchRouteResult>
}

async function renderSandbox(options: SandboxRenderOptions = {}) {
  const user = userEvent.setup()
  const preferences = makeUserPreferences({
    sandbox: { ...DEFAULT_SANDBOX_PREFERENCES, ...options.sandbox },
  })
  const settings = makeSettingsResponse({ preferences })
  const fetchRoutes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/settings',
      respond: () => ({ json: settings }),
    },
    {
      method: 'PATCH',
      path: '/api/settings',
      respond: options.patch ?? (() => ({ json: settings })),
    },
    {
      method: 'GET',
      path: '/api/health',
      respond: () => ({
        json: makeHealthResponse({
          ...options.health,
          sandbox: {
            available: true,
            enabled: false,
            enforced: false,
            ...options.health?.sandbox,
          },
        }),
      }),
    },
  ]
  const result = renderWithProviders(<SandboxSettings />, {
    fetchRoutes,
    auth: false,
    theme: false,
    tts: false,
  })
  await user.click(screen.getByRole('button', { name: /^Sandbox/ }))
  return { ...result, user }
}

function patchBodies(fetchFake: ReturnType<typeof renderWithProviders>['fetchFake']) {
  return fetchFake.findRequests('PATCH', '/api/settings').map((request) => request.body)
}

function sandboxPatch(sandbox: Partial<SandboxPreferences>) {
  return { preferences: { sandbox: { ...DEFAULT_SANDBOX_PREFERENCES, ...sandbox } } }
}

describe('SandboxSettings', () => {
  it('keeps the controls collapsed until the disclosure is expanded', async () => {
    const user = userEvent.setup()
    const preferences = makeUserPreferences({ sandbox: DEFAULT_SANDBOX_PREFERENCES })
    renderWithProviders(<SandboxSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences }) }) },
        { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse({ sandbox: { available: true, enabled: false, enforced: false } }) }) },
      ],
    })

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
    await renderSandbox({ sandbox: { enabled: true } })

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeChecked()
  })

  it('writes only the sandbox preference when toggled and shows the restart notice', async () => {
    const { user, fetchFake } = await renderSandbox({ health: { opencodeRestartPending: true } })

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true })])
    expect(
      screen.getByText(
        'Restart the OpenCode server to apply changes to sandbox support or git credentials. Per-session sandbox toggles apply immediately.',
      ),
    ).toBeInTheDocument()
  })

  it('disables the switch with a visible reason when microVMs are unavailable', async () => {
    await renderSandbox({
      health: { sandbox: { available: false, enabled: false, enforced: false, reason: 'KVM is not available on this host' } },
    })

    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()
  })

  it('still allows disabling an already-enabled preference when microVMs become unavailable', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: { enabled: true },
      health: { sandbox: { available: false, enabled: false, enforced: false, reason: 'KVM is not available on this host' } },
    })

    const toggle = screen.getByRole('switch', { name: 'Toggle sandbox' })
    expect(toggle).toBeChecked()
    expect(toggle).not.toBeDisabled()
    expect(screen.getByText('KVM is not available on this host')).toBeInTheDocument()

    await user.click(toggle)

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: false })])
  })

  it('disables the switch while sandbox availability has not been reported', async () => {
    const preferences = makeUserPreferences({ sandbox: DEFAULT_SANDBOX_PREFERENCES })
    renderWithProviders(<SandboxSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences }) }) },
        {
          method: 'GET',
          path: '/api/health',
          respond: () => new Promise<FetchRouteResult>(() => {}),
        },
      ],
    })

    await screen.findByRole('button', { name: /^Sandbox/ })
    expect(screen.getByRole('switch', { name: 'Toggle sandbox' })).toBeDisabled()
    expect(screen.getByText('Checking sandbox availability...')).toBeInTheDocument()
  })

  it('shows the reported msb version when present', async () => {
    await renderSandbox({ health: { sandbox: { available: true, enabled: false, enforced: false, msbVersion: '0.9.1' } } })

    expect(screen.getByText('msb 0.9.1')).toBeInTheDocument()
  })

  it('shows an error toast when saving the preference fails', async () => {
    const { user } = await renderSandbox({
      patch: () => {
        throw new Error('network')
      },
    })

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(await screen.findByText('Failed to update sandbox preference')).toBeInTheDocument()
  })

  it('shows the backend error when enabling sandboxing is rejected', async () => {
    const { user } = await renderSandbox({
      patch: () => ({
        status: 400,
        json: { error: 'Cannot enable sandboxing: process identity attestation is unavailable' },
      }),
    })

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(
      await screen.findByText('Cannot enable sandboxing: process identity attestation is unavailable'),
    ).toBeInTheDocument()
  })

  it('preserves the git credential preference when the sandbox toggle changes', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { gitCredentials: true } })

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox' }))

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, gitCredentials: true })])
  })

  it('enables git credential forwarding without changing the sandbox preference', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true } })

    await user.click(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' }))

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, gitCredentials: true })])
  })

  it('disables the git credential switch while sandboxing is off', async () => {
    await renderSandbox()

    expect(screen.getByRole('switch', { name: 'Toggle git credentials in sandbox' })).toBeDisabled()
  })

  it('hides the default-for-new-sessions switch while sandboxing is off', async () => {
    await renderSandbox()

    expect(screen.queryByRole('switch', { name: 'Toggle sandbox for new sessions' })).not.toBeInTheDocument()
  })

  it('saves the default-for-new-sessions preference preserving other fields', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: { enabled: true, gitCredentials: true, defaultForNewSessions: true },
    })

    await user.click(screen.getByRole('switch', { name: 'Toggle sandbox for new sessions' }))

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, gitCredentials: true, defaultForNewSessions: false })])
  })

  it('reflects the persisted default-for-new-sessions preference', async () => {
    await renderSandbox({ sandbox: { enabled: true, defaultForNewSessions: false } })

    expect(screen.getByRole('switch', { name: 'Toggle sandbox for new sessions' })).not.toBeChecked()
  })

  it('renders the resource inputs when sandboxing is enabled', async () => {
    await renderSandbox({ sandbox: { enabled: true } })

    expect(screen.getByLabelText('Default CPUs')).toBeInTheDocument()
    expect(screen.getByLabelText('Default memory (GiB)')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove idle sandbox VMs after (minutes)')).toBeInTheDocument()
    expect(screen.getByLabelText('Max running sandbox VMs')).toBeInTheDocument()
  })

  it('hides the resource inputs while sandboxing is off', async () => {
    await renderSandbox()

    expect(screen.queryByLabelText('Default CPUs')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Max running sandbox VMs')).not.toBeInTheDocument()
  })

  it('saves CPUs while preserving the other sandbox fields', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: {
        enabled: true,
        gitCredentials: true,
        defaultForNewSessions: false,
        idleStopMinutes: 45,
        maxRunningVms: 6,
      },
    })

    const cpus = screen.getByLabelText('Default CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')
    await user.tab()

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, gitCredentials: true, defaultForNewSessions: false, idleStopMinutes: 45, maxRunningVms: 6, cpus: 8 })])
  })

  it('saves memory in MiB from the GiB input', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true } })

    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '2.5')
    await user.tab()

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, memoryMib: 2560 })])
  })

  it('omits CPUs when cleared to use the server default', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: { enabled: true, cpus: 4, memoryMib: 4096 },
    })

    await user.clear(screen.getByLabelText('Default CPUs'))
    await user.tab()

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, memoryMib: 4096 })])
  })

  it('omits memory when cleared to use the server default', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: { enabled: true, cpus: 4, memoryMib: 4096 },
    })

    await user.clear(screen.getByLabelText('Default memory (GiB)'))
    await user.tab()

    expect(patchBodies(fetchFake)).toEqual([sandboxPatch({ enabled: true, cpus: 4 })])
  })

  it('rejects out-of-range CPUs, keeps the stored value, and warns', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true, cpus: 4 } })

    const cpus = screen.getByLabelText('Default CPUs')
    await user.clear(cpus)
    await user.type(cpus, '999')
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
    expect(await screen.findByText('Default CPUs must be a whole number from 1 to 64')).toBeInTheDocument()
    expect(screen.getByLabelText('Default CPUs')).toHaveValue(4)
  })

  it('rejects out-of-range memory and warns', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true } })

    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '0.5')
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
    expect(await screen.findByText('Default memory must be between 1 and 1024 GiB')).toBeInTheDocument()
  })

  it('shows the backend error when the resource preference is rejected', async () => {
    const { user } = await renderSandbox({
      sandbox: { enabled: true },
      patch: () => ({ status: 400, json: { error: 'Default memory exceeds the host memory' } }),
    })

    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.type(memory, '64')
    await user.tab()

    expect(await screen.findByText('Default memory exceeds the host memory')).toBeInTheDocument()
  })

  it('does not save CPUs when blurred without a change', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true, cpus: 4 } })

    const cpus = screen.getByLabelText('Default CPUs')
    await user.click(cpus)
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
  })

  it('does not save CPUs when a blank value already uses the server default', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true } })

    const cpus = screen.getByLabelText('Default CPUs')
    await user.click(cpus)
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
  })

  it('does not save memory when blurred without a change', async () => {
    const { user, fetchFake } = await renderSandbox({
      sandbox: { enabled: true, memoryMib: 4096 },
    })

    const memory = screen.getByLabelText('Default memory (GiB)')
    await user.click(memory)
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
  })

  it('does not save idle stop or max running VMs when blurred at the defaults', async () => {
    const { user, fetchFake } = await renderSandbox({ sandbox: { enabled: true } })

    await user.click(screen.getByLabelText('Remove idle sandbox VMs after (minutes)'))
    await user.tab()
    await user.click(screen.getByLabelText('Max running sandbox VMs'))
    await user.tab()

    expect(patchBodies(fetchFake)).toHaveLength(0)
  })
})
