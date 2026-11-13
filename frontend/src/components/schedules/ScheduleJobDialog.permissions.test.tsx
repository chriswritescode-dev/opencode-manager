import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS } from '@opencode-manager/shared/schemas'
import {
  bashDenyPatternsTextarea,
  makeScheduleJobFixture,
  renderScheduleJobDialog,
} from '@/test/scheduleJobDialog'

async function navigateToGeneralTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'General' }))
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Test Job')
  await user.click(screen.getByRole('tab', { name: 'Prompt' }))
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Run a test')
}

function getExternalDirSwitch() {
  return screen.getByRole('switch', { name: 'Allow access outside the working directory' })
}

function getAllowQuestionsSwitch() {
  return screen.getByRole('switch', { name: 'Allow questions' })
}

describe('ScheduleJobDialog — permission config', () => {
  it('shows default deny patterns and external-directory toggle off for a new job', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog()

    await navigateToGeneralTab(user)

    expect(await screen.findByLabelText('Blocked bash commands')).toHaveValue(
      DEFAULT_DESTRUCTIVE_BASH_PATTERNS.join('\n'),
    )
    expect(getExternalDirSwitch()).not.toBeChecked()
    expect(getAllowQuestionsSwitch()).not.toBeChecked()
  })

  it('names each form switch after its visible label', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog()

    await navigateToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Allow access outside the working directory' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Allow questions' })).toBeInTheDocument()
  })

  it('names the missing required fields while Create schedule is disabled', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog()

    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
    expect(screen.getByText('Required: name, prompt')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Test Job')

    expect(screen.getByText('Required: prompt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  })

  it('initializes permission config from an existing job', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({
        permissionConfig: {
          allowExternalDirectory: true,
          allowQuestions: true,
          bashDenyPatterns: ['rm -rf *', 'sudo *'],
        },
      }),
    })

    await navigateToGeneralTab(user)

    expect(await screen.findByLabelText('Blocked bash commands')).toHaveValue('rm -rf *\nsudo *')
    expect(getExternalDirSwitch()).toBeChecked()
    expect(getAllowQuestionsSwitch()).toBeChecked()
  })

  it('submits permissionConfig in the create payload', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog()

    await navigateToGeneralTab(user)
    await fillRequiredFields(user)
    await navigateToGeneralTab(user)

    await user.click(getExternalDirSwitch())
    await user.click(screen.getByRole('button', { name: /Create schedule/i }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))

    expect(dialog.onSubmit.mock.calls[0][0].permissionConfig).toEqual({
      allowExternalDirectory: true,
      allowQuestions: false,
      bashDenyPatterns: [...DEFAULT_DESTRUCTIVE_BASH_PATTERNS],
    })
  })

  it('submits allowQuestions true when the questions toggle is enabled', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog()

    await navigateToGeneralTab(user)
    await fillRequiredFields(user)
    await navigateToGeneralTab(user)

    await user.click(getAllowQuestionsSwitch())
    await user.click(screen.getByRole('button', { name: /Create schedule/i }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))

    expect(dialog.onSubmit.mock.calls[0][0].permissionConfig).toEqual({
      allowExternalDirectory: false,
      allowQuestions: true,
      bashDenyPatterns: [...DEFAULT_DESTRUCTIVE_BASH_PATTERNS],
    })
  })

  it('strips empty lines from bash deny patterns before submitting', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog()

    await navigateToGeneralTab(user)
    await fillRequiredFields(user)
    await navigateToGeneralTab(user)

    const textarea = bashDenyPatternsTextarea()
    await user.clear(textarea)
    await user.type(textarea, 'rm -rf *{Enter}{Enter}{Enter}sudo *{Enter}{Enter}')

    await user.click(screen.getByRole('button', { name: /Create schedule/i }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))

    expect(dialog.onSubmit.mock.calls[0][0].permissionConfig).toEqual({
      allowExternalDirectory: false,
      allowQuestions: false,
      bashDenyPatterns: ['rm -rf *', 'sudo *'],
    })
  })

  it('submits updated permissionConfig when editing an existing job', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({
      job: makeScheduleJobFixture({
        permissionConfig: {
          allowExternalDirectory: false,
          allowQuestions: true,
          bashDenyPatterns: ['rm -rf *', 'git push --force*'],
        },
      }),
    })

    await navigateToGeneralTab(user)

    await user.click(getExternalDirSwitch())
    await user.type(bashDenyPatternsTextarea(), '{Enter}sudo *')

    await user.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => expect(dialog.onSubmit).toHaveBeenCalledTimes(1))

    expect(dialog.onSubmit.mock.calls[0][0].permissionConfig).toEqual({
      allowExternalDirectory: true,
      allowQuestions: true,
      bashDenyPatterns: ['rm -rf *', 'git push --force*', 'sudo *'],
    })
  })
})
