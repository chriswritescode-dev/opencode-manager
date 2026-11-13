import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScheduleJobDialog, makeScheduleJobFixture } from '@/test/scheduleJobDialog'

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Nightly health check')
  await user.click(screen.getByRole('tab', { name: 'Prompt' }))
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Check the repo.')
}

async function goToGeneralTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'General' }))
}

describe('ScheduleJobDialog — inbox', () => {
  it('submits showInInbox true by default for a new schedule', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog()

    await fillRequiredFields(user)
    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Show runs in inbox' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))
    expect(dialog.onSubmit.mock.calls[0][0].showInInbox).toBe(true)
  })

  it('submits showInInbox false when the inbox switch is turned off', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog()

    await fillRequiredFields(user)
    await goToGeneralTab(user)

    await user.click(screen.getByRole('switch', { name: 'Show runs in inbox' }))
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))
    expect(dialog.onSubmit.mock.calls[0][0].showInInbox).toBe(false)
  })

  it('keeps showInInbox false from an existing job when the switch is untouched', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({ job: makeScheduleJobFixture({ showInInbox: false }) })

    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Show runs in inbox' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))
    expect(dialog.onSubmit.mock.calls[0][0].showInInbox).toBe(false)
  })
})
