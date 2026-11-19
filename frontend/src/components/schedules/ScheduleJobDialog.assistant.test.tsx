import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { renderScheduleJobDialog, makeScheduleJobFixture } from '@/test/scheduleJobDialog'
import { makeAgent } from '@/test/promptInput'

const assistantAgents = { '/workspace/repos/assistant': [makeAgent({ id: 'build', name: 'Build', mode: 'primary' })] }

describe('ScheduleJobDialog — assistant create guard', () => {
  it('renders Assistant as the first repository option', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({ showRepoSelector: true })

    await user.click(screen.getByPlaceholderText('Select a repository'))

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Built-in assistant')).toBeInTheDocument()
  })

  it('disables submit when no repo is selected, enables when Assistant repo is selected', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({ showRepoSelector: true })

    await waitFor(() => expect(screen.getByRole('button', { name: /Create schedule/i })).toBeDisabled())

    await user.type(screen.getByLabelText('Name'), 'Test Assistant Job')
    await user.click(screen.getByRole('tab', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Run a test analysis')

    expect(screen.getByRole('button', { name: /Create schedule/i })).toBeDisabled()

    await dialog.rerenderWith({ repoId: ASSISTANT_REPO_ID })

    await waitFor(() => expect(screen.getByRole('button', { name: /Create schedule/i })).not.toBeDisabled())
  })

  it('lists agents from the selected repo directory instead of the default workspace', async () => {
    const dialog = await renderScheduleJobDialog({
      showRepoSelector: true,
      repoId: ASSISTANT_REPO_ID,
      agents: assistantAgents,
    })

    await waitFor(() => {
      expect(dialog.fetchFake.lastRequest('GET', '/api/opencode/api/agent')?.searchParams.get('location[directory]')).toBe(
        '/workspace/repos/assistant',
      )
    })
    expect(dialog.fetchFake.findRequests('GET', '/api/opencode/api/agent')[0]?.searchParams.get('location[directory]')).toBe(
      '/workspace/repos/assistant',
    )
  })

  it.each([
    { storedAgent: 'assistant', savedAgent: undefined },
    { storedAgent: 'build', savedAgent: 'build' },
  ])('saves agent $savedAgent when the stored agent is $storedAgent', async ({ storedAgent, savedAgent }) => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({
      job: makeScheduleJobFixture({
        repoId: ASSISTANT_REPO_ID,
        name: 'Assistant job',
        agentSlug: storedAgent,
        prompt: 'Run a test analysis',
      }),
      agents: assistantAgents,
    })

    await waitFor(() => {
      expect(dialog.fetchFake.lastRequest('GET', '/api/opencode/api/agent')?.searchParams.get('location[directory]')).toBe(
        '/workspace/repos/assistant',
      )
    })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(dialog.onSubmit.mock.calls[0][0].agentSlug).toBe(savedAgent)
  })
})
