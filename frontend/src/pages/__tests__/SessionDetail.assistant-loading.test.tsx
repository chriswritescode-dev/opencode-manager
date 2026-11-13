import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import { connectTestEventStream } from '@/test/render'
import { renderSessionPage } from '@/test/sessionPage'
import { installMatchMedia } from '@/test/browserFakes'

const assistantRepo = makeRepo({
  id: 0,
  name: 'assistant',
  localPath: 'repos/assistant',
  fullPath: '/abs/assistant',
})

function subscribedDirectories(eventStream: ReturnType<typeof renderSessionPage>['eventStream']): string[] {
  const subscribePosts = (eventStream?.posts ?? []).filter((post) => post.path === '/api/sse/subscribe')
  return subscribePosts.flatMap((post) => ('directories' in post.body ? post.body.directories ?? [] : []))
}

describe('SessionDetail assistant loading at repoId=0', () => {
  beforeEach(() => {
    installMatchMedia(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 780 })
  })

  it('does not show the repository loading state for assistant sessions', async () => {
    renderSessionPage({ route: '/repos/0/sessions/sess-asst-1?assistant=1', repo: assistantRepo })

    expect(await screen.findByTestId('session-header-region')).toBeInTheDocument()
    expect(screen.queryByText('Loading repository...')).not.toBeInTheDocument()
  })

  it('names the assistant workspace in the header', async () => {
    renderSessionPage({ route: '/repos/0/sessions/sess-asst-1?assistant=1', repo: assistantRepo })

    const header = await screen.findByTestId('session-header-region')
    expect(within(header).getByText('Assistant')).toBeInTheDocument()
  })

  it('loads skills for the assistant directory instead of an empty directory', async () => {
    const { fetchFake } = renderSessionPage({
      route: '/repos/0/sessions/sess-asst-1?assistant=1&dialog=skills',
      repo: assistantRepo,
      session: makeSession({ id: 'sess-asst-1', location: { directory: '/abs/assistant' } }),
    })

    await waitFor(() => {
      expect(fetchFake.findRequests('GET', '/api/opencode/api/skill')).not.toHaveLength(0)
    })
    const skillDirectories = fetchFake.findRequests('GET', '/api/opencode/api/skill').map(
      (request) => request.searchParams.get('location[directory]'),
    )
    expect(skillDirectories).toContain('/abs/assistant')
    expect(skillDirectories).not.toContain('')
    expect(skillDirectories).not.toContain(null)
  })

  it('subscribes to the session directory when it differs from the repo path', async () => {
    const { eventStream } = renderSessionPage({
      route: '/repos/0/sessions/sess-wt-1?assistant=1',
      repo: assistantRepo,
      session: makeSession({
        id: 'sess-wt-1',
        title: 'Scheduled run',
        location: { directory: '/abs/worktrees/job-1-run-1' },
      }),
    })

    await connectTestEventStream(eventStream)
    await waitFor(() => expect(subscribedDirectories(eventStream)).toContain('/abs/worktrees/job-1-run-1'))
  })

  it('subscribes to the repo path when the session lives in the repo directory', async () => {
    const { eventStream } = renderSessionPage({
      route: '/repos/0/sessions/sess-asst-1?assistant=1',
      repo: assistantRepo,
      session: makeSession({
        id: 'sess-asst-1',
        title: 'Assistant chat',
        location: { directory: '/abs/assistant' },
      }),
    })

    await connectTestEventStream(eventStream)
    await waitFor(() => expect(subscribedDirectories(eventStream)).toEqual(['/abs/assistant']))
  })

  it('shows the repository loading state for a non-assistant session whose repo has not loaded', async () => {
    renderSessionPage({
      route: '/repos/1/sessions/sess-1',
      repoRespond: () => new Promise<never>(() => undefined),
    })

    expect(await screen.findByText('Loading repository...')).toBeInTheDocument()
  })
})
