import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeRepo } from '@/test/fixtures/api'
import { createTestQueryClient } from '@/test/render'
import { jsonStatus, renderRepoDetailPage } from '@/test/repoPage'

describe('RepoDetail not-found handling', () => {
  it('shows a not-found state with a way home without retrying the missing repo', async () => {
    let repoRequests = 0
    const { capturedPathname } = renderRepoDetailPage({
      repoRespond: () => {
        repoRequests += 1
        return jsonStatus(404, { error: 'Repository not found' })
      },
    })

    expect(await screen.findByText('Repository not found')).toBeInTheDocument()
    expect(repoRequests).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Back to repositories' }))

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/')
    })
  })

  it('still retries a transient repository failure', async () => {
    let repoRequests = 0
    const queryClient = createTestQueryClient()
    queryClient.setDefaultOptions({ queries: { retryDelay: 0 } })
    renderRepoDetailPage({
      queryClient,
      repoRespond: () => {
        repoRequests += 1
        if (repoRequests < 3) return jsonStatus(500, { error: 'Server error' })
        return { json: makeRepo({ id: 1, name: 'my-repo' }) }
      },
    })

    expect(await screen.findByRole('button', { name: 'New Session' })).toBeInTheDocument()
    expect(repoRequests).toBe(3)
  })
})
