import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import { makeRepo } from '@/test/fixtures/api'
import { LocationCatcher } from '@/test/test-components'
import type { FetchRoute } from '@/test/fetchFake'
import type { GitStatusResponse } from '@/types/git'
import { GitOperationBanner } from './GitOperationBanner'

const idleStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasChanges: true,
  operation: null,
  files: [{ path: 'file.txt', status: 'modified', staged: false }],
}

const sessionRoute: FetchRoute = {
  method: 'POST',
  path: '/api/opencode/api/session',
  respond: () => ({
    json: {
      data: {
        id: 'ses_new',
        projectID: 'proj_1',
        title: 'Resolve merge conflicts',
        time: { created: 1, updated: 1 },
        location: { directory: '/abs/repos/my-repo' },
      },
    },
  }),
}

const fetchRoutes: FetchRoute[] = [
  {
    method: 'GET',
    path: '/api/repos/1',
    respond: () => ({ json: makeRepo({ id: 1, fullPath: '/abs/repos/my-repo', currentBranch: 'main', defaultBranch: 'main' }) }),
  },
  { method: 'POST', path: '/api/repos/1/git/operation/continue', respond: () => ({ json: idleStatus }) },
  { method: 'POST', path: '/api/repos/1/git/operation/abort', respond: () => ({ json: idleStatus }) },
  sessionRoute,
  {
    method: 'POST',
    path: '/api/opencode/api/session/ses_new/prompt',
    respond: () => ({
      json: {
        data: {
          id: 'msg_1',
          sessionID: 'ses_new',
          time: { created: 1 },
          type: 'user',
          payload: { text: 'Resolve the conflicts' },
        },
      },
    }),
  },
]

interface BannerRenderOptions {
  capturedPathname?: { current: string }
}

function renderBanner(
  operation: Parameters<typeof GitOperationBanner>[0]['operation'],
  options: BannerRenderOptions = {},
) {
  const capturedPathname = options.capturedPathname ?? { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={{ current: '' }} />
      <GitOperationBanner repoId={1} operation={operation} />
    </>,
    { auth: false, theme: false, toaster: true, fetchRoutes },
  )
  return { ...result, capturedPathname }
}

describe('GitOperationBanner', () => {
  beforeEach(() => {
    installPointerCapture()
  })

  it('shows the operation kind and conflicted files', () => {
    renderBanner({ kind: 'merge', conflictedFiles: ['file.txt', 'other.ts'] })

    expect(screen.getByText('Merge in progress')).toBeInTheDocument()
    expect(screen.getByText('file.txt')).toBeInTheDocument()
    expect(screen.getByText('other.ts')).toBeInTheDocument()
    expect(screen.getByText('2 conflicts')).toBeInTheDocument()
  })

  it('disables continue while conflicts remain and enables it once resolved', () => {
    const first = renderBanner({ kind: 'merge', conflictedFiles: ['file.txt'] })
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    first.unmount()

    renderBanner({ kind: 'merge', conflictedFiles: [] })
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('continues the operation when continue is clicked', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBanner({ kind: 'rebase', conflictedFiles: [] })

    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/repos/1/git/operation/continue')).toHaveLength(1))
    expect(await screen.findByText('Operation continued')).toBeInTheDocument()
  })

  it('requires confirmation before aborting', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBanner({ kind: 'cherry-pick', conflictedFiles: ['file.txt'] })

    await user.click(screen.getByRole('button', { name: /abort/i }))
    expect(fetchFake.findRequests('POST', '/api/repos/1/git/operation/abort')).toHaveLength(0)

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Abort' }))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/repos/1/git/operation/abort')).toHaveLength(1))
  })

  it('only offers agent resolution while conflicts remain', async () => {
    const first = renderBanner({ kind: 'merge', conflictedFiles: [] })
    expect(screen.queryByRole('button', { name: /resolve with agent/i })).not.toBeInTheDocument()
    first.unmount()

    renderBanner({ kind: 'merge', conflictedFiles: ['file.txt'] })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /resolve with agent/i })).toBeEnabled(),
    )
  })

  it('starts agent resolution with the current operation, branch and a session for it', async () => {
    const user = userEvent.setup()
    const capturedPathname = { current: '' }
    const { fetchFake } = renderBanner(
      { kind: 'merge', conflictedFiles: ['file.txt'] },
      { capturedPathname },
    )

    const button = screen.getByRole('button', { name: /resolve with agent/i })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session')?.body).toMatchObject({
        location: { directory: '/abs/repos/my-repo' },
        title: 'Resolve merge conflicts',
      }),
    )

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_new/prompt')?.body).toMatchObject({
        text: expect.stringMatching(/branch `main`[\s\S]*file\.txt/),
      }),
    )

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1/sessions/ses_new'))
  })
})
