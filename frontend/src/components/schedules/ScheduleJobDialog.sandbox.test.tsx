import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScheduleJobDialog, makeScheduleJobFixture } from '@/test/scheduleJobDialog'
import type { UserPreferences } from '@/api/types/settings'

const sandboxPreferences = (enabled: boolean, resources: { cpus?: number; memoryMib?: number } = {}): Partial<UserPreferences> => ({
  sandbox: { enabled, ...resources },
})

async function goToGeneralTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'General' }))
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Nightly health check')
  await user.click(screen.getByRole('tab', { name: 'Prompt' }))
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Check the repo.')
}

describe('ScheduleJobDialog — sandbox', () => {
  it('submits the CPU and memory overrides when sandboxing is enabled', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({ preferences: sandboxPreferences(true) })

    await fillRequiredFields(user)
    await goToGeneralTab(user)

    await user.click(screen.getByRole('switch', { name: 'Run in sandbox' }))
    await user.type(screen.getByLabelText('CPUs'), '4')
    await user.type(screen.getByLabelText('Memory (GiB)'), '12')

    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))
    expect(dialog.onSubmit.mock.calls[0][0].sandbox).toEqual({
      enabled: true,
      resources: { cpus: 4, memoryMib: 12288 },
    })
  })

  it('uses the sandbox resource defaults as placeholders', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      preferences: sandboxPreferences(true, { cpus: 7, memoryMib: 8192 }),
    })

    await goToGeneralTab(user)
    await user.click(screen.getByRole('switch', { name: 'Run in sandbox' }))

    expect(screen.getByLabelText('CPUs')).toHaveAttribute('placeholder', '7')
    expect(screen.getByLabelText('Memory (GiB)')).toHaveAttribute('placeholder', '8')
  })

  it('disables the switch with an explanation while sandboxing is turned off in settings', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({ preferences: sandboxPreferences(false) })

    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Run in sandbox' })).toBeDisabled()
    expect(screen.getByText('Sandboxing is turned off in Settings.')).toBeInTheDocument()
  })

  it('explains why the switch is disabled when the host cannot sandbox', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      preferences: sandboxPreferences(true),
      sandbox: { available: false, reason: 'Sandbox runtime is not installed' },
    })

    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Run in sandbox' })).toBeDisabled()
    expect(await screen.findByText('Sandbox runtime is not installed')).toBeInTheDocument()
  })

  it('submits sandbox null when an existing sandboxed job is turned off', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({
      preferences: sandboxPreferences(true),
      job: makeScheduleJobFixture({
        name: 'Nightly health check',
        prompt: 'Check the repo.',
        sandbox: { enabled: true, resources: { cpus: 4, memoryMib: 12288 } },
      }),
    })

    await goToGeneralTab(user)

    const toggle = screen.getByRole('switch', { name: 'Run in sandbox' })
    expect(toggle).toBeChecked()
    expect(screen.getByLabelText('CPUs')).toHaveValue(4)

    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))
    expect(dialog.onSubmit.mock.calls[0][0].sandbox).toBeNull()
  })

  it('hides the sandbox option for a non-local server target', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      preferences: sandboxPreferences(true),
      job: makeScheduleJobFixture({
        repoId: null,
        serverId: 'srv_kitchen',
        directory: '/srv/projects/audit',
        workspaceMode: 'in-place',
      }),
      serverTarget: { serverId: 'srv_kitchen', directory: '/srv/projects/audit' },
    })

    await goToGeneralTab(user)

    expect(screen.queryByRole('switch', { name: 'Run in sandbox' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sandbox')).not.toBeInTheDocument()
  })
})
