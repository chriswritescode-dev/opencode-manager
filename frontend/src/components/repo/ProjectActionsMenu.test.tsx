import { act, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectActionsMenu } from './ProjectActionsMenu'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { ProjectConfigResponse, TerminalInfo } from '@opencode-manager/shared/types'

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

function untrustedResponse(hash: string): FetchRouteResult {
  return {
    status: 409,
    json: { error: 'Repository commands are not trusted', code: 'REPO_CONFIG_UNTRUSTED', details: { hash } },
  }
}

function configRoute(respond: (request: { searchParams: URLSearchParams }, call: number) => FetchRouteResult): FetchRoute {
  let calls = 0
  return {
    method: 'GET',
    path: '/api/repos/1/project-config',
    respond: (request) => {
      calls += 1
      return respond(request, calls)
    },
  }
}

const staticConfig = (config: ProjectConfigResponse): FetchRoute => configRoute(() => ({ json: config }))

const emptyTerminals: FetchRoute = {
  method: 'GET',
  path: '/api/repos/1/terminals',
  respond: () => ({ json: { terminals: [] } }),
}

function runRoute(responses: FetchRouteResult[]): FetchRoute {
  let calls = 0
  return {
    method: 'POST',
    path: '/api/repos/1/project-config/actions/:actionId/run',
    respond: () => {
      const response = responses[Math.min(calls, responses.length - 1)] ?? responses[0]
      calls += 1
      return response
    },
  }
}

interface SwitchDirectoryRef {
  current: ((directory: string) => void) | undefined
}

interface MenuHarnessProps {
  directory: string
  capturedSearch: { current: string }
  switchDirectoryRef: SwitchDirectoryRef
}

function MenuHarness({ directory, capturedSearch, switchDirectoryRef }: MenuHarnessProps) {
  const [currentDirectory, setCurrentDirectory] = useState(directory)
  switchDirectoryRef.current = setCurrentDirectory

  return (
    <>
      <LocationCatcher capturedSearch={capturedSearch} />
      <ProjectActionsMenu repoId={1} directory={currentDirectory} />
    </>
  )
}

function renderMenu(options: {
  directory?: string
  config: FetchRoute
  extraRoutes?: FetchRoute[]
}) {
  installPointerCapture()
  const capturedSearch = { current: '' }
  const switchDirectoryRef: SwitchDirectoryRef = { current: undefined }
  const view = renderWithProviders(
    <MenuHarness directory={options.directory ?? '/repo'} capturedSearch={capturedSearch} switchDirectoryRef={switchDirectoryRef} />,
    {
      auth: false,
      theme: false,
      route: '/repos/1',
      fetchRoutes: [...(options.extraRoutes ?? []), options.config, emptyTerminals],
    },
  )
  return { ...view, capturedSearch, switchDirectoryRef }
}

describe('ProjectActionsMenu', () => {
  it('opens the terminal panel on the run terminal when an action succeeds', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderMenu({
      config: staticConfig(makeConfig([devAction])),
      extraRoutes: [
        runRoute([{ json: { terminal: runningTerminal, alreadyRunning: false, autoOpenUrl: false } }]),
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(capturedSearch.current).toContain('dialog=terminal'))
    expect(capturedSearch.current).toContain('terminal=term-1')
  })

  it('shows a running dot and a Stop item that removes the running terminal', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderMenu({
      config: staticConfig(makeConfig([devAction])),
      extraRoutes: [
        { method: 'GET', path: '/api/repos/1/terminals', respond: () => ({ json: { terminals: [runningTerminal] } }) },
        { method: 'DELETE', path: '/api/repos/1/terminals/term-1', respond: () => ({ status: 204 }) },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByTestId('action-running-dot')).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: /stop/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('DELETE', '/api/repos/1/terminals/term-1')?.searchParams.get('directory')).toBe('/repo'),
    )
  })

  it('trusts the repository config after a 409 and retries the run', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderMenu({
      config: staticConfig(makeConfig([repoAction], HASH, repoExecutable)),
      extraRoutes: [
        runRoute([
          untrustedResponse(HASH),
          { json: { terminal: runningTerminal, alreadyRunning: false, autoOpenUrl: false } },
        ]),
        { method: 'POST', path: '/api/repos/1/project-config/trust', respond: () => ({ json: makeConfig([repoAction], HASH, repoExecutable) }) },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()
    expect(await screen.findByText('pnpm dev')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /trust and run/i }))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/repos/1/project-config/actions/dev/run')).toHaveLength(2))
    expect(fetchFake.lastRequest('POST', '/api/repos/1/project-config/trust')?.body).toEqual({
      hash: HASH,
      directory: '/repo',
    })
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
    renderMenu({
      config: staticConfig(makeConfig([repoAction], HASH, executable)),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    const userStep = userEvent.setup()
    await userStep.click(screen.getByRole('button', { name: 'Project actions' }))
    await userStep.click(await screen.findByRole('menuitem', { name: /dev server/i }))

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
    const user = userEvent.setup()
    renderMenu({
      config: staticConfig(makeConfig([repoAction], HASH)),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Repository actions changed. Reopen the menu to review them.')).toBeInTheDocument()
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
  })

  it('shows the freshly verified command when the cached config is stale', async () => {
    const user = userEvent.setup()
    const staleAction: ProjectConfigResponse['actions'][number] = { ...repoAction, command: 'pnpm dev:stale' }
    renderMenu({
      config: configRoute((_request, call) => ({
        json: call === 1 ? makeConfig([staleAction], HASH, repoExecutable) : makeConfig([repoAction], HASH, repoExecutable),
      })),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('pnpm dev')).toBeInTheDocument()
    expect(screen.queryByText('pnpm dev:stale')).not.toBeInTheDocument()
  })

  it('refuses confirmation when the fresh hash differs from the 409 hash', async () => {
    const user = userEvent.setup()
    renderMenu({
      config: configRoute((_request, call) => ({
        json: makeConfig([repoAction], call === 1 ? HASH : OTHER_HASH, repoExecutable),
      })),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Repository actions changed. Reopen the menu to review them.')).toBeInTheDocument()
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
  })

  it('refuses confirmation when the action is no longer a repository action', async () => {
    const user = userEvent.setup()
    renderMenu({
      config: configRoute((_request, call) => ({
        json: makeConfig([call === 1 ? repoAction : devAction], HASH, repoExecutable),
      })),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    expect(await screen.findByText('Repository actions changed. Reopen the menu to review them.')).toBeInTheDocument()
    expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument()
  })

  it('cancels a pending confirmation when the directory changes', async () => {
    const user = userEvent.setup()
    const { switchDirectoryRef } = renderMenu({
      config: staticConfig(makeConfig([repoAction], HASH, repoExecutable)),
      extraRoutes: [runRoute([untrustedResponse(HASH)])],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))
    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()

    act(() => switchDirectoryRef.current?.('/other'))

    await waitFor(() => expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument())
  })

  it('does not retry the run when the trust response arrives after switching directory', async () => {
    const user = userEvent.setup()
    let releaseTrust: (() => void) | undefined
    const { switchDirectoryRef, fetchFake } = renderMenu({
      config: staticConfig(makeConfig([repoAction], HASH, repoExecutable)),
      extraRoutes: [
        runRoute([untrustedResponse(HASH)]),
        {
          method: 'POST',
          path: '/api/repos/1/project-config/trust',
          respond: () =>
            new Promise((resolve) => {
              releaseTrust = () => resolve({ json: makeConfig([repoAction], HASH, repoExecutable) })
            }),
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))
    expect(await screen.findByText('Trust repository actions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /trust and run/i }))
    expect(fetchFake.findRequests('POST', '/api/repos/1/project-config/actions/dev/run')).toHaveLength(1)

    act(() => switchDirectoryRef.current?.('/other'))
    await waitFor(() => expect(screen.queryByText('Trust repository actions')).not.toBeInTheDocument())

    await act(async () => {
      releaseTrust?.()
    })
    expect(fetchFake.findRequests('POST', '/api/repos/1/project-config/actions/dev/run')).toHaveLength(1)
  })

  it('opens the resolved URL when the action opts into auto-open', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderMenu({
      config: staticConfig(makeConfig([devAction])),
      extraRoutes: [
        runRoute([
          {
            json: {
              terminal: runningTerminal,
              alreadyRunning: false,
              resolvedUrl: 'http://localhost:3000',
              autoOpenUrl: true,
            },
          },
        ]),
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /dev server/i }))

    await waitFor(() => expect(capturedSearch.current).toContain('dialog=preview'))
    expect(capturedSearch.current).toContain('previewPort=3000')
  })

  it('shows the empty state and manage entry when no actions are configured', async () => {
    const user = userEvent.setup()
    renderMenu({ config: staticConfig(makeConfig([])) })

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByText('No actions configured')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /manage actions/i })).toBeInTheDocument()
  })
})
