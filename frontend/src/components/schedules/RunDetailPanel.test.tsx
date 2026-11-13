import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'
import { describe, expect, it } from 'vitest'
import { RunDetailPanel } from './RunDetailPanel'
import { renderWithProviders, type TestRenderResult } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { installSpeechSynthesis } from '@/test/browserFakes'
import { makeRepo, makeSession, makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { ScheduleRun } from '@opencode-manager/shared/types'

const speech = installSpeechSynthesis(['Test Voice'])
const UtteranceConstructor = globalThis.SpeechSynthesisUtterance

const repo = makeRepo({
  id: 5,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
  defaultBranch: 'main',
  cloneStatus: 'ready',
})

const run: ScheduleRun = {
  id: 1,
  jobId: 1,
  repoId: 5,
  triggerSource: 'manual',
  status: 'completed',
  startedAt: 0,
  finishedAt: null,
  viewedAt: null,
  createdAt: 0,
  sessionId: null,
  sessionTitle: null,
  logText: null,
  responseText: '[Report](recaps/daily.html)\n\n[Docs](https://example.com)',
  errorText: null,
  runBranch: null,
  commitHash: null,
  worktreePath: null,
}

const ttsPreferences = makeUserPreferences({
  tts: {
    enabled: true,
    provider: 'builtin',
    autoPlay: false,
    endpoint: 'https://api.openai.com',
    apiKey: '',
    voice: 'Test Voice',
    model: 'tts-1',
    speed: 1,
  },
})

function baseRoutes(overrides: FetchRoute[] = []): FetchRoute[] {
  return [
    ...overrides,
    { method: 'GET', path: '/api/repos/5', respond: () => ({ json: repo }) },
    { method: 'POST', path: '/api/schedules/all/runs/:runId/viewed', respond: () => ({ json: { updated: true } }) },
    {
      method: 'GET',
      path: '/api/files',
      respond: (request) => {
        const path = request.searchParams.get('path') ?? ''
        const selected = path.endsWith('/daily.html')
        return {
          json: selected
            ? {
                name: 'daily.html',
                path,
                isDirectory: false,
                size: 10,
                mimeType: 'text/html',
                content: '<p>hi</p>',
                lastModified: new Date(0),
              }
            : { workspaceRoot: '/abs', children: [] },
        }
      },
    },
  ]
}

function renderPanel(options: {
  activeRun?: ScheduleRun | null
  overrides?: FetchRoute[]
  tts?: boolean
  settingsRoute?: FetchRoute
}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const view = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <RunDetailPanel
        repoId={5}
        activeRun={options.activeRun === undefined ? run : options.activeRun}
        selectedRunLoading={false}
        onCancelRun={() => undefined}
        cancelRunPending={false}
      />
    </>,
    {
      tts: options.tts ?? true,
      fetchRoutes: [
        ...baseRoutes(options.overrides),
        ...(options.settingsRoute ? [options.settingsRoute] : []),
      ],
    },
  )
  return { ...view, capturedPathname, capturedSearch }
}

function clickLink(name: string): boolean {
  const link = screen.getByRole('link', { name })
  return fireEvent(link, new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function waitForRepoQuery(result: TestRenderResult): Promise<void> {
  return waitFor(() => expect(result.queryClient.getQueryState(['repo', 5])?.status).toBe('success'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('speechSynthesis', speech)
  vi.stubGlobal('SpeechSynthesisUtterance', UtteranceConstructor)
  speech.spoken.length = 0
  speech.cancel.mockClear()
})

describe('RunDetailPanel read aloud', () => {
  it('reads the run output aloud', async () => {
    renderPanel({
      tts: true,
      settingsRoute: { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences: ttsPreferences }) }) },
    })

    const readAloud = await screen.findByRole('button', { name: 'Read aloud' })
    fireEvent.click(readAloud)

    await waitFor(() => expect(speech.spoken.length).toBeGreaterThan(0))
    const spoken = speech.spoken.map((entry) => entry.text).join(' ')
    expect(spoken).toContain('Report')
    expect(spoken).toContain('Docs')
  })

  it('stops playback when this run is playing', async () => {
    renderPanel({
      tts: true,
      settingsRoute: { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences: ttsPreferences }) }) },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Read aloud' }))
    await waitFor(() => expect(speech.spoken.length).toBeGreaterThan(0))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop playback' }))

    expect(speech.cancel).toHaveBeenCalled()
  })

  it('hides the button without output', () => {
    renderPanel({
      tts: true,
      activeRun: { ...run, responseText: null },
      settingsRoute: { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences: ttsPreferences }) }) },
    })

    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument()
  })

  it('hides the button when TTS is disabled', () => {
    renderPanel({ tts: true })

    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument()
  })
})

describe('RunDetailPanel local link handling', () => {
  it('prevents navigation and opens no sheet while the repo query is pending', async () => {
    const result = renderPanel({
      overrides: [{ method: 'GET', path: '/api/repos/5', respond: () => new Promise<FetchRouteResult>(() => undefined) }],
    })

    await screen.findByRole('status')

    expect(clickLink('Report')).toBe(false)
    expect(result.fetchFake.findRequests('GET', '/api/files')).toHaveLength(0)
  })

  it('prevents navigation, shows a retryable error, and refetches when the repo query fails', async () => {
    let calls = 0
    const result = renderPanel({
      overrides: [
        {
          method: 'GET',
          path: '/api/repos/5',
          respond: () => {
            calls += 1
            if (calls === 1) throw new Error('failed')
            return { json: repo }
          },
        },
      ],
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load repository details for local links.')

    expect(clickLink('Report')).toBe(false)
    expect(result.fetchFake.findRequests('GET', '/api/files')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(result.fetchFake.findRequests('GET', '/api/repos/5')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(/Could not load repository details/)).toBeNull())
  })

  it('opens the sheet with the resolved path once the repo is loaded and keeps external links external', async () => {
    const result = renderPanel({
      overrides: [
        {
          method: 'GET',
          path: '/api/files',
          respond: (request) => {
            const path = request.searchParams.get('path') ?? ''
            if (path.endsWith('/daily.html')) {
              return {
                json: {
                  name: 'daily.html',
                  path,
                  isDirectory: false,
                  size: 10,
                  mimeType: 'text/html',
                  content: '<p>hi</p>',
                  lastModified: new Date(0),
                },
              }
            }
            return { json: { workspaceRoot: '/abs', children: [] } }
          },
        },
      ],
    })

    await waitFor(() => expect(result.queryClient.getQueryState(['repo', 5])?.status).toBe('success'))

    expect(clickLink('Report')).toBe(false)
    await waitFor(() =>
      expect(
        result.fetchFake.findRequests('GET', '/api/files').some((request) => request.searchParams.get('path') === 'repos/my-repo/recaps/daily.html'),
      ).toBe(true),
    )

    const docs = screen.getByRole('link', { name: 'Docs' })
    expect(docs.getAttribute('target')).toBe('_blank')
    expect(docs.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('marks an unread completed run viewed and skips running or already-viewed runs', async () => {
    const completed = renderPanel({ activeRun: { ...run, status: 'completed', viewedAt: null } })
    await waitFor(() => expect(completed.fetchFake.findRequests('POST', '/api/schedules/all/runs/1/viewed')).toHaveLength(1))
    completed.unmount()

    const running = renderPanel({ activeRun: { ...run, status: 'running', viewedAt: null } })
    await waitForRepoQuery(running)
    expect(running.fetchFake.findRequests('POST', '/api/schedules/all/runs/1/viewed')).toHaveLength(0)
    running.unmount()

    const viewed = renderPanel({ activeRun: { ...run, status: 'completed', viewedAt: 123 } })
    await waitForRepoQuery(viewed)
    expect(viewed.fetchFake.findRequests('POST', '/api/schedules/all/runs/1/viewed')).toHaveLength(0)
  })
})

describe('RunDetailPanel open session', () => {
  function createSessionRoutes(): FetchRoute[] {
    return [
      {
        method: 'POST',
        path: '/api/opencode/api/session',
        respond: () => ({ json: { data: makeSession({ id: 'ses_new', title: 'Continued' }) } }),
      },
      {
        method: 'POST',
        path: '/api/opencode/api/session/ses_new/synthetic',
        respond: () => ({ json: {} }),
      },
    ]
  }

  async function clickOpenSession() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open session' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
  }

  it('opens the original session for a run that worked in the repository', async () => {
    const result = renderPanel({ activeRun: { ...run, sessionId: 'ses_run', worktreePath: null } })

    await clickOpenSession()

    await waitFor(() => expect(result.capturedPathname.current).toBe('/repos/5/sessions/ses_run'))
    expect(result.fetchFake.findRequests('POST', '/api/opencode/api/session')).toHaveLength(0)
  })

  it('opens the original session while a worktree run is still running', async () => {
    const result = renderPanel({
      activeRun: { ...run, status: 'running', sessionId: 'ses_run', worktreePath: '/abs/worktrees/run-1', runBranch: 'schedule/1/run-1' },
    })

    await clickOpenSession()

    await waitFor(() => expect(result.capturedPathname.current).toBe('/repos/5/sessions/ses_run'))
    expect(result.fetchFake.findRequests('POST', '/api/opencode/api/session')).toHaveLength(0)
  })

  it('opens the original session for a finished run whose worktree was kept', async () => {
    const result = renderPanel({
      activeRun: { ...run, status: 'completed', sessionId: 'ses_run', worktreePath: '/abs/worktrees/job-1-run-1', runBranch: 'schedule/1/run-1' },
    })

    await clickOpenSession()

    await waitFor(() => expect(result.capturedPathname.current).toBe('/repos/5/sessions/ses_run'))
    expect(result.fetchFake.findRequests('POST', '/api/opencode/api/session')).toHaveLength(0)
  })

  it('opens a new repo session seeded with the full output and branch for a finished worktree run', async () => {
    const result = renderPanel({
      activeRun: {
        ...run,
        sessionId: 'ses_run',
        sessionTitle: 'Daily recap',
        finishedAt: Date.UTC(2026, 9, 2),
        worktreePath: null,
        runBranch: 'schedule/run-1',
        commitHash: 'abc123',
      },
      overrides: createSessionRoutes(),
    })

    await clickOpenSession()

    await waitFor(() => expect(result.capturedPathname.current).toBe('/repos/5/sessions/ses_new'))
    expect(result.fetchFake.lastRequest('POST', '/api/opencode/api/session')?.body).toMatchObject({
      title: 'Daily recap (continued)',
      location: { directory: '/abs/repos/my-repo' },
    })
    const context = result.fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_new/synthetic')?.body
    expect(JSON.stringify(context)).toContain('scheduled run #1 \\"Daily recap\\", which completed and finished at 2026-10-02T00:00:00.000Z')
    expect(JSON.stringify(context)).toContain('branch `schedule/run-1` at commit `abc123`')
    expect(JSON.stringify(context)).toContain('Run output')
  })

  it('includes the error and notes no committed changes for a failed worktree run', async () => {
    const result = renderPanel({
      activeRun: {
        ...run,
        status: 'failed',
        responseText: null,
        errorText: 'Model timed out',
        worktreePath: null,
        runBranch: 'schedule/1/run-1',
      },
      overrides: createSessionRoutes(),
    })

    await clickOpenSession()

    await waitFor(() => expect(result.fetchFake.findRequests('POST', '/api/opencode/api/session')).toHaveLength(1))
    expect(result.fetchFake.lastRequest('POST', '/api/opencode/api/session')?.body).toMatchObject({
      title: 'Scheduled run (continued)',
      location: { directory: '/abs/repos/my-repo' },
    })
    const context = JSON.stringify(result.fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_new/synthetic')?.body)
    expect(context).toContain('ended as failed')
    expect(context).toContain('committed no changes')
    expect(context).toContain('The run produced no output.')
    expect(context).toContain('Run error')
    expect(context).toContain('Model timed out')
  })

  it('shows a single open session button', async () => {
    renderPanel({ activeRun: { ...run, sessionId: 'ses_run', worktreePath: null, runBranch: 'schedule/1/run-1' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open session' })).toBeEnabled())
    expect(screen.getAllByRole('button', { name: /session|repo/i })).toHaveLength(1)
  })
})
