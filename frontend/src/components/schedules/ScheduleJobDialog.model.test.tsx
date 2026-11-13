import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  renderScheduleJobDialog,
  makeCatalogModels,
  makeConfigProvider,
  makeScheduleJobFixture,
} from '@/test/scheduleJobDialog'

const openaiProvider = makeConfigProvider({ id: 'openai', name: 'OpenAI' })

const gpt5 = makeCatalogModels([{ providerID: 'openai', id: 'gpt-5', name: 'GPT-5' }])

const gpt5And4o = makeCatalogModels([
  { providerID: 'openai', id: 'gpt-5', name: 'GPT-5' },
  { providerID: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
])

describe('ScheduleJobDialog — model fallback', () => {
  it('leaves the model at the workspace default when the stored model no longer exists', async () => {
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1, model: 'openai/retired' }),
      repoId: 1,
      providers: [openaiProvider],
      models: gpt5,
    })

    await waitFor(() => expect(screen.queryByDisplayValue('openai/retired')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('Workspace default')).toBeInTheDocument()
  })

  it('saves no model override for a stale model', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1, model: 'openai/retired' }),
      repoId: 1,
      providers: [openaiProvider],
      models: gpt5,
    })

    await waitFor(() => expect(screen.queryByDisplayValue('openai/retired')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(dialog.onSubmit).toHaveBeenCalledTimes(1)
    expect(dialog.onSubmit.mock.calls[0][0].model).toBeUndefined()
  })

  it('keeps a stored model that is still available', async () => {
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1, model: 'openai/gpt-5' }),
      repoId: 1,
      providers: [openaiProvider],
      models: gpt5,
    })

    expect(await screen.findByDisplayValue('GPT-5')).toBeInTheDocument()
  })

  it('treats a stored backing model id as unavailable', async () => {
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1, model: 'openai/gpt-5-2025-08-07' }),
      repoId: 1,
      providers: [openaiProvider],
      models: gpt5,
    })

    await waitFor(() => expect(screen.queryByDisplayValue('openai/gpt-5-2025-08-07')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('Workspace default')).toBeInTheDocument()
  })

  it('keeps a stored model when the catalog is confirmed empty', async () => {
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1, model: 'openai/retired' }),
      repoId: 1,
      providers: [],
      models: [],
    })

    expect(await screen.findByDisplayValue('openai/retired')).toBeInTheDocument()
  })

  it('shows Default from OpenCode when no model is configured', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1 }),
      repoId: 1,
      providers: [openaiProvider],
      models: gpt5And4o,
      defaultModel: { providerID: 'openai', id: 'gpt-5' },
    })

    const modelInput = await screen.findByPlaceholderText('Workspace default')
    await user.click(modelInput)

    const listbox = await screen.findByRole('listbox')
    const defaultGroup = within(listbox).getByText('Default')
    const providerGroup = within(listbox).getByText('OpenAI')
    expect(within(listbox).getByText('Default: GPT-5')).toBeInTheDocument()
    expect(defaultGroup.compareDocumentPosition(providerGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
