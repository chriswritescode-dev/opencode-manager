import { beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { installMatchMedia, installWindowSize } from '@/test/browserFakes'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import { renderSessionPage } from '@/test/sessionPage'
import type { FetchFake, FetchRouteResult } from '@/test/fetchFake'

const SESSION_ID = 'session-1'
const REPO_DIRECTORY = '/test/repo'
const SESSION_DIRECTORY = '/test/elsewhere'
const GOAL_PATH = '/api/opencode/api/rpc/opencode.goal/get'

function deferred() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((resolveResult) => {
    resolve = resolveResult
  })
  return { promise, resolve }
}

function goalDirectories(fetchFake: FetchFake): Array<string | null> {
  return fetchFake
    .findRequests('POST', GOAL_PATH)
    .map((request) => request.searchParams.get('location[directory]'))
}

describe('SessionDetail goal reads', () => {
  beforeEach(() => {
    installMatchMedia(false)
    installWindowSize(900)
  })

  it('reads the goal with the session directory once it resolves instead of the repo directory', async () => {
    const sessionResponse = deferred()
    const session = makeSession({
      id: SESSION_ID,
      title: 'Elsewhere',
      location: { directory: SESSION_DIRECTORY },
    })
    const { fetchFake } = renderSessionPage({
      repo: makeRepo({ id: 1, fullPath: REPO_DIRECTORY }),
      session,
      sessionRespond: () => sessionResponse.promise,
    })

    await waitFor(() => expect(document.querySelector('[data-prompt-input]')).not.toBeNull())
    expect(goalDirectories(fetchFake)).toEqual([])

    sessionResponse.resolve({ json: { data: session } })

    await waitFor(() => expect(goalDirectories(fetchFake).length).toBeGreaterThan(0))
    expect(new Set(goalDirectories(fetchFake))).toEqual(new Set([SESSION_DIRECTORY]))
  })
})
