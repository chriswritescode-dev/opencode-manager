import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { UserPreferences } from '@/api/types/settings'
import { useSettings } from '@/hooks/useSettings'
import { createUseSettingsMock } from '@/test/test-utils'
import { RepoGitIdentitySelect } from './RepoGitIdentitySelect'

const { getRepoGitIdentityMock, updateRepoGitIdentityMock, showToastMock } = vi.hoisted(() => ({
  getRepoGitIdentityMock: vi.fn(),
  updateRepoGitIdentityMock: vi.fn(),
  showToastMock: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}))

vi.mock('@/api/repos', () => ({
  getRepoGitIdentity: getRepoGitIdentityMock,
  updateRepoGitIdentity: updateRepoGitIdentityMock,
}))

vi.mock('@/api/git', () => ({
  getApiErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

vi.mock('@/lib/toast', () => ({ showToast: showToastMock }))
vi.mock('@/hooks/useSettings')

const preset = { id: 'a', name: 'Alpha', email: 'alpha@example.com' }

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
    gitIdentities: [preset],
    ...overrides,
  }
}

function renderSelect(preferences: Partial<UserPreferences> = {}) {
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({ preferences: buildPreferences(preferences) }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return render(<RepoGitIdentitySelect repoId={7} />, { wrapper: Wrapper })
}

function openSelect(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('combobox', { name: 'Commit identity' }))
}

describe('RepoGitIdentitySelect', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the effective default identity and its Manager source', async () => {
    getRepoGitIdentityMock.mockResolvedValue({ name: 'Ada', email: 'ada@example.com', scope: 'default', presetId: null })
    renderSelect()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' }))
        .toHaveTextContent('Default — Ada <ada@example.com> (Manager default)'))
  })

  it('shows the global git config source and the not-configured fallback', async () => {
    getRepoGitIdentityMock.mockResolvedValue({ name: 'Ada', email: 'ada@example.com', scope: 'global', presetId: null })
    const { unmount } = renderSelect()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' }))
        .toHaveTextContent('Default — Ada <ada@example.com> (git global config)'))
    unmount()

    getRepoGitIdentityMock.mockResolvedValue({ name: null, email: null, scope: 'none', presetId: null })
    renderSelect()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' }))
        .toHaveTextContent('Default — not configured'))
  })

  it('selects the matching preset for a repository identity', async () => {
    getRepoGitIdentityMock.mockResolvedValue({ name: 'Alpha', email: 'alpha@example.com', scope: 'repository', presetId: 'a' })
    renderSelect()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' }))
        .toHaveTextContent('Alpha <alpha@example.com>'))
  })

  it('shows a custom repository identity and confirms before replacing it', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    getRepoGitIdentityMock.mockResolvedValue({ name: 'Custom', email: 'custom@example.com', scope: 'repository', presetId: null })
    renderSelect()

    await openSelect(user)
    const customOption = screen.getByRole('option', { name: 'Custom (Custom <custom@example.com>)' })
    expect(customOption).toHaveAttribute('data-disabled')

    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Custom <custom@example.com>'))
    expect(updateRepoGitIdentityMock).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))

    await waitFor(() => expect(updateRepoGitIdentityMock).toHaveBeenCalledWith(7, 'a'))
  })

  it('sends null when choosing Default and the preset id when choosing a preset', async () => {
    const user = userEvent.setup()
    getRepoGitIdentityMock.mockResolvedValue({ name: 'Alpha', email: 'alpha@example.com', scope: 'repository', presetId: 'a' })
    updateRepoGitIdentityMock.mockResolvedValue({ name: null, email: null, scope: 'none', presetId: null })
    renderSelect()

    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Default' }))
    await waitFor(() => expect(updateRepoGitIdentityMock).toHaveBeenCalledWith(7, null))

    updateRepoGitIdentityMock.mockResolvedValue({ name: 'Alpha', email: 'alpha@example.com', scope: 'repository', presetId: 'a' })
    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))
    await waitFor(() => expect(updateRepoGitIdentityMock).toHaveBeenCalledWith(7, 'a'))
  })
})
