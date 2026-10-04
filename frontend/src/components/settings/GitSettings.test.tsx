import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { GitSettings } from './GitSettings'
import type { UserPreferences } from '@/api/types/settings'

const {
  getSettingsMock,
  updateSettingsMock,
  listReposMock,
  updateRepoGitCredentialMock,
  showToastMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  listReposMock: vi.fn(),
  updateRepoGitCredentialMock: vi.fn(),
  showToastMock: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getSettings: getSettingsMock,
    updateSettings: updateSettingsMock,
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: listReposMock,
  updateRepoGitCredential: updateRepoGitCredentialMock,
}))

vi.mock('@/lib/toast', () => ({ showToast: showToastMock }))

vi.mock('@/hooks/useOpenCodeServerActions', () => ({
  useOpenCodeServerActions: () => ({
    restartServerMutation: { isPending: false },
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    activeSessionCount: 0,
    requestRestart: vi.fn(),
    confirmRestart: vi.fn(),
  }),
}))

vi.mock('./GitCredentialDialog', () => ({
  GitCredentialDialog: ({
    open,
    onSave,
  }: {
    open: boolean
    onSave: (credential: unknown, options: unknown) => Promise<void>
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          void onSave(
            { name: 'Work', host: 'github.com', type: 'pat', token: 'tok' },
            { makeDefault: false, repoIds: [] },
          )
        }
      >
        Confirm credential save
      </button>
    ) : null,
}))

function buildPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    theme: 'dark',
    mode: 'build',
    autoScroll: true,
    expandDiffs: true,
    expandToolCalls: false,
    showReasoning: false,
    simpleChatMode: false,
    keyboardShortcuts: {},
    customCommands: [],
    gitCredentials: [],
    gitIdentity: { name: '', email: '' },
    gitIdentities: [],
    ...overrides,
  }
}

let serverPreferences: UserPreferences

function setupServer(initial: UserPreferences) {
  serverPreferences = initial
  getSettingsMock.mockImplementation(async () => ({ preferences: serverPreferences, updatedAt: Date.now() }))
  updateSettingsMock.mockImplementation(async (request: { preferences: Partial<UserPreferences> }) => {
    serverPreferences = { ...serverPreferences, ...request.preferences }
    return { preferences: serverPreferences, updatedAt: Date.now() }
  })
}

function renderGitSettings(repos: unknown[] = []) {
  listReposMock.mockResolvedValue(repos)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, ...render(<GitSettings />, { wrapper: Wrapper }) }
}

function defaultIdentityNameInput() {
  return screen.getByLabelText('Name', { selector: 'input#git-name' })
}

function savedIdentityNameInput(index = 0) {
  return screen.getByLabelText('Name', { selector: `input#git-identity-${index}-name` })
}

describe('GitSettings draft preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps default identity edits when a saved identity is removed', async () => {
    const user = userEvent.setup()
    setupServer(
      buildPreferences({
        gitIdentity: { name: 'Old Name', email: 'old@example.com' },
        gitIdentities: [{ id: 'a', name: 'Alpha', email: 'alpha@example.com' }],
      }),
    )
    renderGitSettings()

    const nameInput = await screen.findByLabelText('Name', { selector: 'input#git-name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')
    expect(nameInput).toHaveValue('New Name')

    await user.click(screen.getByTitle('Delete'))

    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument())
    expect(defaultIdentityNameInput()).toHaveValue('New Name')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('keeps saved identity drafts when a credential is saved', async () => {
    const user = userEvent.setup()
    setupServer(buildPreferences())
    renderGitSettings()

    await screen.findByLabelText('Name', { selector: 'input#git-name' })

    await user.click(screen.getAllByRole('button', { name: 'Add' })[1])
    const identityNameInput = await screen.findByLabelText('Name', { selector: 'input#git-identity-0-name' })
    await user.type(identityNameInput, 'Draft Person')

    await user.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await user.click(await screen.findByRole('button', { name: 'Confirm credential save' }))

    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalled())
    expect(savedIdentityNameInput()).toHaveValue('Draft Person')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('keeps saved identity drafts when a credential is deleted', async () => {
    const user = userEvent.setup()
    setupServer(
      buildPreferences({
        gitCredentials: [{ id: 'cred-1', name: 'Work', host: 'github.com', type: 'pat', token: 'tok' }],
      }),
    )
    renderGitSettings()

    await screen.findByLabelText('Name', { selector: 'input#git-name' })

    await user.click(screen.getAllByRole('button', { name: 'Add' })[1])
    const identityNameInput = await screen.findByLabelText('Name', { selector: 'input#git-identity-0-name' })
    await user.type(identityNameInput, 'Draft Person')

    await user.click(screen.getAllByTitle('Delete')[0])

    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalled())
    expect(savedIdentityNameInput()).toHaveValue('Draft Person')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('removes a saved identity without touching repositories', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    setupServer(
      buildPreferences({
        gitIdentities: [{ id: 'a', name: 'Alpha', email: 'alpha@example.com' }],
      }),
    )
    renderGitSettings([
      {
        id: 1,
        localPath: 'repo-one',
        fullPath: '/workspace/repo-one',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      },
    ])

    await screen.findByLabelText('Name', { selector: 'input#git-name' })
    await user.click(await screen.findByTitle('Delete'))

    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(updateRepoGitCredentialMock).not.toHaveBeenCalled()
    expect(listReposMock).toHaveBeenCalledTimes(1)
  })

  it('invalidates the repo git identity cache after saving', async () => {
    const user = userEvent.setup()
    setupServer(buildPreferences())
    const { queryClient } = renderGitSettings()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const nameInput = await screen.findByLabelText('Name', { selector: 'input#git-name' })
    await user.type(nameInput, 'New Name')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repoGitIdentity'] }))
  })

  it('retains identity drafts when saving fails', async () => {
    const user = userEvent.setup()
    setupServer(buildPreferences())
    updateSettingsMock.mockRejectedValueOnce(new Error('network down'))
    renderGitSettings()

    const nameInput = await screen.findByLabelText('Name', { selector: 'input#git-name' })
    await user.type(nameInput, 'Draft Name')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(showToastMock.error).toHaveBeenCalled())
    expect(defaultIdentityNameInput()).toHaveValue('Draft Name')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })
})
