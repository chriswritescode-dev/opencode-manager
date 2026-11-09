import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Repo } from '@/api/types'

vi.mock('@/api/repos', () => ({ getRepo: vi.fn() }))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: ({
    isOpen,
    basePath,
    repoName,
    repoId,
    allowNavigateAboveBase,
    onClose,
  }: {
    isOpen: boolean
    basePath?: string
    repoName?: string
    repoId?: number
    allowNavigateAboveBase?: boolean
    onClose: () => void
  }) => (
    <div
      data-testid="file-browser-sheet"
      data-open={String(isOpen)}
      data-base-path={basePath}
      data-repo-name={repoName}
      data-repo-id={repoId}
      data-allow-above={String(allowNavigateAboveBase)}
    >
      <button type="button" onClick={onClose}>close file browser</button>
    </div>
  ),
}))

vi.mock('@/components/repo/RepoMcpDialog', () => ({
  RepoMcpDialog: ({ open, directory }: { open: boolean; directory?: string }) => (
    <div data-testid="repo-mcp-dialog" data-open={String(open)} data-directory={directory} />
  ),
}))

vi.mock('@/components/repo/RepoSkillsDialog', () => ({
  RepoSkillsDialog: ({ open, repoId, directory }: { open: boolean; repoId?: number; directory?: string }) => (
    <div data-testid="repo-skills-dialog" data-open={String(open)} data-repo-id={repoId} data-directory={directory} />
  ),
}))

vi.mock('@/components/secrets/RepoSecretsDialog', () => ({
  RepoSecretsDialog: ({ open, repoId }: { open: boolean; repoId: number }) => (
    <div data-testid="repo-secrets-dialog" data-open={String(open)} data-repo-id={repoId} />
  ),
}))

vi.mock('@/components/source-control/SourceControlPanel', () => ({
  SourceControlPanel: ({
    isOpen,
    repoId,
    currentBranch,
    repoName,
  }: {
    isOpen: boolean
    repoId: number
    currentBranch: string
    repoName?: string
  }) => (
    <div
      data-testid="source-control-panel"
      data-open={String(isOpen)}
      data-repo-id={repoId}
      data-current-branch={currentBranch}
      data-repo-name={repoName}
    />
  ),
}))

vi.mock('@/components/source-control/RemoteSourceControlContent', () => ({
  RemoteSourceControlPanel: ({
    isOpen,
    serverId,
    directory,
  }: {
    isOpen: boolean
    serverId: string
    directory: string
  }) => (
    <div
      data-testid="remote-source-control-panel"
      data-open={String(isOpen)}
      data-server-id={serverId}
      data-directory={directory}
    />
  ),
}))

vi.mock('@/components/terminal/TerminalPanel', () => ({
  TerminalPanel: ({
    isOpen,
    target,
    directory,
  }: {
    isOpen: boolean
    target: { kind: 'repo'; repoId: number } | { kind: 'server'; serverId: string }
    directory?: string
  }) => (
    <div
      data-testid="terminal-panel"
      data-open={String(isOpen)}
      data-target-kind={target.kind}
      data-target-id={target.kind === 'repo' ? target.repoId : target.serverId}
      data-directory={directory}
    />
  ),
}))

vi.mock('@/components/preview/PreviewPanel', () => ({
  PreviewPanel: ({ isOpen, directory }: { isOpen: boolean; directory?: string }) => (
    <div data-testid="preview-panel" data-open={String(isOpen)} data-directory={directory} />
  ),
}))

vi.mock('@/components/repo/ResetPermissionsDialog', () => ({
  ResetPermissionsDialog: ({ open, repoId }: { open: boolean; repoId: number }) => (
    <div data-testid="reset-permissions-dialog" data-open={String(open)} data-repo-id={repoId} />
  ),
}))

vi.mock('@/components/repo/RepoActionsDialog', () => ({
  RepoActionsDialog: ({ open, repoId, directory }: { open: boolean; repoId: number; directory?: string }) => (
    <div data-testid="repo-actions-dialog" data-open={String(open)} data-repo-id={repoId} data-directory={directory} />
  ),
}))

vi.mock('@/components/repo/MultiRunSheet', () => ({
  MultiRunSheet: ({
    open,
    target,
    directory,
    defaultBaseRef,
  }: {
    open: boolean
    target: { kind: 'repo'; repoId: number }
    directory?: string
    defaultBaseRef?: string
  }) => (
    <div
      data-testid="multi-run-sheet"
      data-open={String(open)}
      data-target-id={target.repoId}
      data-directory={directory}
      data-base-ref={defaultBaseRef}
    />
  ),
}))

import { getRepo } from '@/api/repos'
import { ProjectToolsHost } from './ProjectToolsHost'

const TEST_REPO = {
  id: 2,
  name: 'Two',
  localPath: '/repos/two',
  fullPath: '/repos/two/checkout',
  currentBranch: 'feature',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
} satisfies Repo

function LocationSpy() {
  const location = useLocation()
  return <div data-testid="search">{location.search}</div>
}

function renderHost(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ProjectToolsHost />
        <LocationSpy />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getRepo).mockReset()
  vi.mocked(getRepo).mockResolvedValue(TEST_REPO)
})

describe('ProjectToolsHost', () => {
  it('renders nothing without a tool project', () => {
    renderHost('/repos/1')

    expect(screen.queryByTestId('file-browser-sheet')).not.toBeInTheDocument()
    expect(screen.queryByTestId('repo-mcp-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument()
    expect(getRepo).not.toHaveBeenCalled()
  })

  it('opens the repo file browser for a repo target and keeps the other repo dialogs closed', async () => {
    renderHost('/repos/1?dialog=files&toolProject=repo%3A2')

    const sheet = await screen.findByTestId('file-browser-sheet')

    expect(getRepo).toHaveBeenCalledWith(2)
    expect(sheet).toHaveAttribute('data-open', 'true')
    expect(sheet).toHaveAttribute('data-base-path', '/repos/two')
    expect(sheet).toHaveAttribute('data-repo-id', '2')
    expect(sheet).toHaveAttribute('data-repo-name', 'Two')
    expect(sheet).toHaveAttribute('data-allow-above', 'true')
    expect(screen.getByTestId('repo-mcp-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('repo-skills-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('repo-secrets-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('source-control-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('preview-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('reset-permissions-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('repo-actions-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('multi-run-sheet')).toHaveAttribute('data-open', 'false')
  })

  it('opens remote source control for a server target', () => {
    renderHost('/servers/srv/sessions/ses_1?dialog=sourceControl&toolProject=server%3Asrv%3A%2Ftmp')

    const panel = screen.getByTestId('remote-source-control-panel')

    expect(panel).toHaveAttribute('data-open', 'true')
    expect(panel).toHaveAttribute('data-server-id', 'srv')
    expect(panel).toHaveAttribute('data-directory', '/tmp')
    expect(getRepo).not.toHaveBeenCalled()
  })

  it('closing the file browser removes the dialog and the tool project', async () => {
    renderHost('/repos/1?dialog=files&toolProject=repo%3A2&keep=1')

    await screen.findByTestId('file-browser-sheet')
    fireEvent.click(screen.getByText('close file browser'))

    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
      expect(params.has('dialog')).toBe(false)
      expect(params.has('toolProject')).toBe(false)
      expect(params.get('keep')).toBe('1')
    })
  })
})
