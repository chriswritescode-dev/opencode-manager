import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS } from '@opencode-manager/shared/schemas'
import type { ScheduleJob } from '@opencode-manager/shared/types'

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const mocks = vi.hoisted(() => ({
  templates: [] as Array<{ id: number; title: string; description: string; category: string; cadenceHint: string; suggestedName: string; suggestedDescription: string; prompt: string }>,
  useDeletePromptTemplateMutate: vi.fn(),
}))

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: mocks.templates, isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: mocks.useDeletePromptTemplateMutate, isPending: false }),
}))

vi.mock('@/api/providers', () => ({
  getProvidersWithModels: () => Promise.resolve([]),
}))

vi.mock('@/api/opencode', () => ({
  createOpenCodeClient: () => ({
    listAgents: () => Promise.resolve([]),
    getConfig: () => Promise.resolve(null),
  }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    listManagedSkills: () => Promise.resolve([]),
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: () => Promise.resolve([]),
  listBranches: () => Promise.resolve({ branches: [], status: { ahead: 0, behind: 0 } }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function getDefaultJob(overrides?: Partial<ScheduleJob>): ScheduleJob {
  return {
    id: 1,
    repoId: 1,
    name: 'Test Job',
    description: null,
    enabled: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Test prompt',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    branch: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  }
}

async function navigateToGeneralTab(user: ReturnType<typeof userEvent.setup>) {
  const generalTab = screen.getByRole('tab', { name: 'General' })
  await user.click(generalTab)
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  const nameInput = screen.getByLabelText('Name')
  await user.type(nameInput, 'Test Job')
  const promptTab = screen.getByRole('tab', { name: 'Prompt' })
  await user.click(promptTab)
  const promptInput = screen.getByRole('textbox', { name: 'Prompt' })
  await user.type(promptInput, 'Run a test')
}

/** The external-directory switch is the 2nd switch (index 1) after Enabled */
function getExternalDirSwitch() {
  return screen.getAllByRole('switch')[1]
}

describe('ScheduleJobDialog — permission config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows default deny patterns and external-directory toggle off for a new job', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        isSaving={false}
      />,
      { wrapper: createWrapper() },
    )

    await navigateToGeneralTab(user)

    const textarea = await screen.findByLabelText('Blocked bash commands')
    const defaultText = DEFAULT_DESTRUCTIVE_BASH_PATTERNS.join('\n')
    expect(textarea).toHaveValue(defaultText)

    const switchInput = getExternalDirSwitch()
    expect(switchInput).not.toBeChecked()
  })

  it('initializes permission config from an existing job', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    const customPatterns = ['rm -rf *', 'sudo *']
    const job = getDefaultJob({
      permissionConfig: {
        allowExternalDirectory: true,
        bashDenyPatterns: [...customPatterns],
      },
    })

    render(
      <ScheduleJobDialog
        open
        onOpenChange={onOpenChange}
        job={job}
        onSubmit={onSubmit}
        isSaving={false}
      />,
      { wrapper: createWrapper() },
    )

    await navigateToGeneralTab(user)

    const textarea = await screen.findByLabelText('Blocked bash commands')
    expect(textarea).toHaveValue(customPatterns.join('\n'))

    const switchInput = getExternalDirSwitch()
    expect(switchInput).toBeChecked()
  })

  it('submits permissionConfig in the create payload', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        isSaving={false}
      />,
      { wrapper: createWrapper() },
    )

    await navigateToGeneralTab(user)
    await fillRequiredFields(user)

    // Navigate back to General tab
    await navigateToGeneralTab(user)

    // Enable external directory access
    const switchInput = getExternalDirSwitch()
    await user.click(switchInput)

    // Submit
    const submitButton = screen.getByRole('button', { name: /Create schedule/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.permissionConfig).toEqual({
      allowExternalDirectory: true,
      bashDenyPatterns: [...DEFAULT_DESTRUCTIVE_BASH_PATTERNS],
    })
  })

  it('strips empty lines from bash deny patterns before submitting', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        isSaving={false}
      />,
      { wrapper: createWrapper() },
    )

    await navigateToGeneralTab(user)
    await fillRequiredFields(user)

    // Navigate back to General tab
    await navigateToGeneralTab(user)

    // Clear and set patterns with empty lines via paste to preserve newlines
    const textarea = await screen.findByLabelText('Blocked bash commands')
    await user.clear(textarea)
    await user.type(textarea, 'rm -rf *{Enter}{Enter}{Enter}sudo *{Enter}{Enter}')

    // Submit
    const submitButton = screen.getByRole('button', { name: /Create schedule/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.permissionConfig).toEqual({
      allowExternalDirectory: false,
      bashDenyPatterns: ['rm -rf *', 'sudo *'],
    })
  })

  it('submits updated permissionConfig when editing an existing job', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    const job = getDefaultJob({
      permissionConfig: {
        allowExternalDirectory: false,
        bashDenyPatterns: ['rm -rf *', 'git push --force*'],
      },
    })

    render(
      <ScheduleJobDialog
        open
        onOpenChange={onOpenChange}
        job={job}
        onSubmit={onSubmit}
        isSaving={false}
      />,
      { wrapper: createWrapper() },
    )

    await navigateToGeneralTab(user)

    // Toggle external directory on
    const switchInput = getExternalDirSwitch()
    await user.click(switchInput)

    // Add a pattern via Enter key
    const textarea = await screen.findByLabelText('Blocked bash commands')
    const existingValue = textarea as HTMLTextAreaElement
    await user.type(existingValue, '{Enter}sudo *')

    // Submit
    const submitButton = screen.getByRole('button', { name: /Save changes/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.permissionConfig).toEqual({
      allowExternalDirectory: true,
      bashDenyPatterns: ['rm -rf *', 'git push --force*', 'sudo *'],
    })
  })
})
