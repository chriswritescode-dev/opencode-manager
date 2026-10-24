import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'
import { FetchError } from '@opencode-manager/shared'
import { LocationCatcher } from '@/test/test-utils'
import { ProjectActionsMenu } from './ProjectActionsMenu'

const mocks = vi.hoisted(() => ({
  useProjectConfig: vi.fn(),
  useTerminals: vi.fn(),
  getProjectConfig: vi.fn(),
  runMutate: vi.fn(),
  removeMutate: vi.fn(),
  trustMutate: vi.fn(),
  openUrlFromManager: vi.fn(),
  showToastError: vi.fn(),
}))

vi.mock('@/api/projectConfig', () => ({
  getProjectConfig: mocks.getProjectConfig,
  useProjectConfig: mocks.useProjectConfig,
  useRunProjectAction: () => ({ mutate: mocks.runMutate, isPending: false }),
  useTrustRepoConfig: () => ({ mutate: mocks.trustMutate, isPending: false }),
}))

vi.mock('@/api/terminals', () => ({
  useTerminals: mocks.useTerminals,
  useRemoveTerminal: () => ({ mutate: mocks.removeMutate, isPending: false }),
}))

vi.mock('@/lib/open-url', () => ({
  openUrlFromManager: mocks.openUrlFromManager,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: mocks.showToastError, success: vi.fn() },
}))

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)

const repoExecutable: NonNullable<ProjectConfigResponse['repoFile']['executable']> = {
  actions: [{ id: 'dev', name: 'Dev server', command: 'pnpm dev', url: null, autoOpenUrl: false }],
  setup: [],
}

const devAction: ProjectConfigResponse['actions'][number] = {
  id: 'dev',
  name: 'Dev server',
  command: 'pnpm dev',
  autoOpenUrl: false,
  source: 'personal',
}

const repoAction: ProjectConfigResponse['actions'][number] = {
  ...devAction,
  source: 'repo',
}

const runningTerminal: TerminalInfo = {
  id: 'term-1',
  title: 'Dev server',
  kind: 'action',
  actionId: 'dev',
  cwd: '/repo',
  status: 'running',
}

function makeConfig(
  actions: ProjectConfigResponse['actions'],
  hash: string | null = null,
  executable: ProjectConfigResponse['repoFile']['executable'] = null,
): ProjectConfigResponse {
  return {
    actions,
    worktreeSetup: [],
    repoFile: {
      path: '.ocm/project.json',
      exists: hash !== null,
      trusted: true,
      hash,
      warnings: [],
      executable,
    },
  }
}

function untrustedError(hash: string): FetchError {
  return new FetchError('Repository commands are not trusted', 409, 'REPO_CONFIG_UNTRUSTED', undefined, {
    details: { hash },
  })
}

function menuTree(directory: string, capturedSearch: { current: string }) {
  return (
    <MemoryRouter initialEntries={['/repos/1']}>
      <LocationCatcher capturedSearch={capturedSearch} />
      <ProjectActionsMenu repoId={1} directory={directory} />
    </MemoryRouter>
  )
}

function renderMenu(directory = '/repo') {
  const capturedSearch: { current: string } = { current: '' }
  const result = render(menuTree(directory, capturedSearch))
  return { ...result, capturedSearch }
}

describe('ProjectActionsMenu', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([devAction]), isLoading: false, error: null })
    mocks.useTerminals.mockReturnValue({ data: [] })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([devAction]))
  })

  it('opens the terminal panel on the run terminal when an action succeeds', async () => {
    mocks.runMutate.mockImplementation((_actionId, options) => {
      options.onSuccess({ terminal: runningTerminal, alreadyRunning: false, autoOpenUrl: false })
    })
    const user = userEvent.setup()
    const { capturedSearch } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(capturedSearch.current).toContain('dialog=terminal'))
    expect(capturedSearch.current).toContain('terminal=term-1')
  })

  it('shows a running dot and a Stop item that removes the running terminal', async () => {
    mocks.useTerminals.mockReturnValue({ data: [runningTerminal] })
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByTestId('action-running-dot')).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: /stop/i }))

    expect(mocks.removeMutate).toHaveBeenCalledWith(
      { ptyID: 'term-1', directory: '/repo' },
      expect.any(Object),
    )
  })

  it('trusts the repository config after a 409 and retries the run', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH, repoExecutable))
    let runCalls = 0
    mocks.runMutate.mockImplementation((_actionId, options) => {
      runCalls += 1
      if (runCalls === 1) {
        options.onError(untrustedError(HASH))
        return
      }
      options.onSuccess({ terminal: runningTerminal, alreadyRunning: false, autoOpenUrl: false })
    })
    mocks.trustMutate.mockImplementation((_vars, options) => options.onSuccess())
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()
    expect(await screen.findByText('pnpm dev')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /trust and run/i }))

    await waitFor(() => expect(mocks.runMutate).toHaveBeenCalledTimes(2))
    expect(mocks.trustMutate).toHaveBeenCalledWith(
      { hash: HASH, directory: '/repo' },
      expect.any(Object),
    )
  })

  it('lists every executable action and setup command, including shadowed actions', async () => {
    const executable: NonNullable<ProjectConfigResponse['repoFile']['executable']> = {
      actions: [
        { id: 'dev', name: 'Dev server', command: 'pnpm dev', url: 'http://localhost:3000', autoOpenUrl: true },
        { id: 'shadowed', name: 'Shadowed action', command: 'pnpm shadowed', url: null, autoOpenUrl: false },
      ],
      setup: ['pnpm install'],
      environment: 'e2e',
      env: { OPENAI_API_KEY: '${{ secrets.OPENAI_API_KEY }}' },
    }
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, executable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH, executable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()
    expect(await screen.findByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Shadowed action')).toBeInTheDocument()
    expect(screen.getByText('pnpm shadowed')).toBeInTheDocument()
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument()
    expect(screen.getByText('Opens URL automatically')).toBeInTheDocument()
    expect(screen.getByText('Environment variables')).toBeInTheDocument()
    expect(screen.getByText('e2e')).toBeInTheDocument()
    expect(screen.getByText('OPENAI_API_KEY = ${{ secrets.OPENAI_API_KEY }}')).toBeInTheDocument()
    expect(screen.getByText('Worktree setup commands')).toBeInTheDocument()
    expect(screen.getByText('pnpm install')).toBeInTheDocument()
  })

  it('does not offer trust when the snapshot has no executable commands', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(mocks.showToastError).toHaveBeenCalled())
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
    expect(mocks.trustMutate).not.toHaveBeenCalled()
  })

  it('shows the freshly verified command when the cached config is stale', async () => {
    const staleAction: ProjectConfigResponse['actions'][number] = { ...repoAction, command: 'pnpm dev:stale' }
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([staleAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH, repoExecutable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('pnpm dev')).toBeInTheDocument()
    expect(screen.queryByText('pnpm dev:stale')).not.toBeInTheDocument()
  })

  it('refuses confirmation when the fresh hash differs from the 409 hash', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], OTHER_HASH, repoExecutable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(mocks.showToastError).toHaveBeenCalled())
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
    expect(mocks.trustMutate).not.toHaveBeenCalled()
  })

  it('refuses confirmation when the action is no longer a repository action', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([devAction], HASH, repoExecutable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(mocks.showToastError).toHaveBeenCalled())
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
    expect(mocks.trustMutate).not.toHaveBeenCalled()
  })

  it('cancels a pending confirmation when the directory changes', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH, repoExecutable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    const user = userEvent.setup()
    const capturedSearch: { current: string } = { current: '' }
    const { rerender } = render(menuTree('/repo', capturedSearch))

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))
    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()

    rerender(menuTree('/other', capturedSearch))

    await waitFor(() =>
      expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument(),
    )
    expect(mocks.trustMutate).not.toHaveBeenCalled()
  })

  it('does not retry the run when the trust response arrives after switching directory', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([repoAction], HASH, repoExecutable), isLoading: false, error: null })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([repoAction], HASH, repoExecutable))
    mocks.runMutate.mockImplementation((_actionId, options) => options.onError(untrustedError(HASH)))
    let trustOptions: { onSuccess: () => void } | undefined
    mocks.trustMutate.mockImplementation((_vars, options) => {
      trustOptions = options
    })
    const user = userEvent.setup()
    const capturedSearch: { current: string } = { current: '' }
    const { rerender } = render(menuTree('/repo', capturedSearch))

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))
    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /trust and run/i }))
    expect(mocks.runMutate).toHaveBeenCalledTimes(1)

    rerender(menuTree('/other', capturedSearch))
    await waitFor(() =>
      expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument(),
    )

    await act(async () => {
      trustOptions?.onSuccess()
    })
    expect(mocks.runMutate).toHaveBeenCalledTimes(1)
  })

  it('opens the resolved URL when the action opts into auto-open', async () => {
    mocks.runMutate.mockImplementation((_actionId, options) => {
      options.onSuccess({
        terminal: runningTerminal,
        alreadyRunning: false,
        resolvedUrl: 'http://localhost:3000',
        autoOpenUrl: true,
      })
    })
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() =>
      expect(mocks.openUrlFromManager).toHaveBeenCalledWith('http://localhost:3000', expect.any(Object)),
    )
  })

  it('shows the empty state and manage entry when no actions are configured', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([]), isLoading: false, error: null })
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByText('No actions configured')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /manage actions/i })).toBeInTheDocument()
  })
})
