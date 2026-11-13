import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useGit } from './useGit'
import type { FetchRouteResult, HttpMethod } from '@/test/fetchFake'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { renderHookWithProviders } from '@/test/render'
import type { GitStatusResponse } from '@/types/git'
import { vcsInfoQueryKey } from '@/lib/queryInvalidation'

type GitHook = ReturnType<typeof useGit>

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const REPO_ID = 1
const REPO_PATH = '/abs/repos/my-repo'

const gitStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  hasChanges: false,
  operation: null,
}

interface MutationCase {
  name: string
  run: (git: GitHook) => Promise<void>
  method: HttpMethod
  path: string
  body?: JsonValue
  respond?: () => FetchRouteResult
  toast: string
  repoMetaInvalidated: boolean
  stashesInvalidated: boolean
  branchesInvalidated: boolean
  vcsInvalidated: boolean
}

function statusReply(): FetchRouteResult {
  return { json: gitStatus }
}

function deleteBranchReply(): FetchRouteResult {
  return { json: { remoteDeleted: false, status: gitStatus } }
}

const mutationCases: MutationCase[] = [
  {
    name: 'fetch',
    run: async (git) => { await git.fetch.mutateAsync() },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/fetch`,
    toast: 'Fetch completed',
    repoMetaInvalidated: true,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: false,
  },
  {
    name: 'pull',
    run: async (git) => { await git.pull.mutateAsync() },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/pull`,
    toast: 'Pull completed',
    repoMetaInvalidated: true,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: false,
  },
  {
    name: 'push',
    run: async (git) => { await git.push.mutateAsync(undefined) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/push`,
    body: { setUpstream: false },
    toast: 'Push completed',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'commit',
    run: async (git) => { await git.commit.mutateAsync({ message: 'test commit' }) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/commit`,
    body: { message: 'test commit' },
    toast: 'Commit created',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'stageFiles',
    run: async (git) => { await git.stageFiles.mutateAsync(['file.txt']) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/stage`,
    body: { paths: ['file.txt'] },
    toast: 'Files staged',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'unstageFiles',
    run: async (git) => { await git.unstageFiles.mutateAsync(['file.txt']) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/unstage`,
    body: { paths: ['file.txt'] },
    toast: 'Files unstaged',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'reset',
    run: async (git) => { await git.reset.mutateAsync('abc123') },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/reset`,
    body: { commitHash: 'abc123' },
    toast: 'Reset to commit',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'continueOperation',
    run: async (git) => { await git.continueOperation.mutateAsync() },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/operation/continue`,
    toast: 'Operation continued',
    repoMetaInvalidated: true,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: false,
  },
  {
    name: 'abortOperation',
    run: async (git) => { await git.abortOperation.mutateAsync() },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/operation/abort`,
    toast: 'Operation aborted',
    repoMetaInvalidated: true,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: false,
  },
  {
    name: 'stashPush',
    run: async (git) => { await git.stashPush.mutateAsync({ message: 'wip', includeUntracked: true }) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/stash`,
    body: { message: 'wip', includeUntracked: true },
    toast: 'Changes stashed',
    repoMetaInvalidated: false,
    stashesInvalidated: true,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'stashApply',
    run: async (git) => { await git.stashApply.mutateAsync({ index: 0, hash: 'abc123', pop: true }) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/stash/0/apply`,
    body: { hash: 'abc123', pop: true },
    toast: 'Stash popped',
    repoMetaInvalidated: false,
    stashesInvalidated: true,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'stashDrop',
    run: async (git) => { await git.stashDrop.mutateAsync({ index: 0, hash: 'abc123' }) },
    method: 'DELETE',
    path: `/api/repos/${REPO_ID}/git/stash/0`,
    body: { hash: 'abc123' },
    toast: 'Stash dropped',
    repoMetaInvalidated: false,
    stashesInvalidated: true,
    branchesInvalidated: false,
    vcsInvalidated: false,
  },
  {
    name: 'deleteBranch',
    run: async (git) => { await git.deleteBranch.mutateAsync({ name: 'feature', force: false, deleteRemote: false }) },
    method: 'DELETE',
    path: `/api/repos/${REPO_ID}/git/branches`,
    body: { name: 'feature', force: false, deleteRemote: false },
    respond: deleteBranchReply,
    toast: 'Branch deleted',
    repoMetaInvalidated: false,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: false,
  },
  {
    name: 'renameBranch',
    run: async (git) => { await git.renameBranch.mutateAsync({ from: 'main', to: 'renamed' }) },
    method: 'POST',
    path: `/api/repos/${REPO_ID}/git/branches/rename`,
    body: { from: 'main', to: 'renamed' },
    toast: 'Branch renamed',
    repoMetaInvalidated: true,
    stashesInvalidated: false,
    branchesInvalidated: true,
    vcsInvalidated: true,
  },
]

function renderGit() {
  const rendered = renderHookWithProviders(() => useGit(REPO_ID), {
    ...hookProviders,
    fetchRoutes: [
      ...mutationCases.map(({ method, path, respond }) => ({
        method,
        path,
        respond: respond ?? statusReply,
      })),
      {
        method: 'POST',
        path: `/api/repos/${REPO_ID}/git/integrate`,
        respond: () => ({ json: { targetRepoId: 2, integratedCommits: 1, targetStatus: gitStatus } }),
      },
    ],
  })

  const otherStatus = { ...gitStatus, branch: 'dev' }
  rendered.queryClient.setQueryData(['repo', REPO_ID], { id: REPO_ID, fullPath: REPO_PATH })
  rendered.queryClient.setQueryData(['repos'], [])
  rendered.queryClient.setQueryData(['repo', 'siblings'], [])
  rendered.queryClient.setQueryData(['branches', REPO_ID], [])
  rendered.queryClient.setQueryData(['gitStatus', REPO_ID], gitStatus)
  rendered.queryClient.setQueryData(['reposGitStatus', [1, 2]], new Map([[1, otherStatus], [2, otherStatus]]))
  rendered.queryClient.setQueryData(['gitLog', REPO_ID], { commits: [] })
  rendered.queryClient.setQueryData(['fileDiff', REPO_ID], [])
  rendered.queryClient.setQueryData(['gitStashes'], { stashes: [] })
  rendered.queryClient.setQueryData(vcsInfoQueryKey(REPO_PATH), { branch: 'main' })

  return { ...rendered, otherStatus }
}

describe('useGit', () => {
  it.each(mutationCases)(
    '$name records the returned status and refreshes the working-tree queries',
    async (mutationCase) => {
      const { result, queryClient, fetchFake, otherStatus } = renderGit()

      await act(async () => {
        await mutationCase.run(result.current)
      })

      const request = fetchFake.lastRequest(mutationCase.method, mutationCase.path)
      expect(request).toBeDefined()
      expect(request?.body).toEqual(mutationCase.body ?? null)
      expect(queryClient.getQueryData(['gitStatus', REPO_ID])).toEqual(gitStatus)

      const batch = queryClient.getQueryData<Map<number, GitStatusResponse>>(['reposGitStatus', [1, 2]])
      expect(batch?.get(1)).toEqual(gitStatus)
      expect(batch?.get(2)).toBe(otherStatus)

      expect(queryClient.getQueryState(['gitLog', REPO_ID])?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['fileDiff', REPO_ID])?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['gitStashes'])?.isInvalidated).toBe(mutationCase.stashesInvalidated)
      expect(queryClient.getQueryState(['branches', REPO_ID])?.isInvalidated).toBe(
        mutationCase.branchesInvalidated,
      )
      expect(queryClient.getQueryState(['repos'])?.isInvalidated).toBe(mutationCase.repoMetaInvalidated)
      expect(queryClient.getQueryState(['repo', REPO_ID])?.isInvalidated).toBe(
        mutationCase.repoMetaInvalidated,
      )
      expect(queryClient.getQueryState(vcsInfoQueryKey(REPO_PATH))?.isInvalidated).toBe(
        mutationCase.vcsInvalidated,
      )
      expect(queryClient.getQueryState(['gitStatus', REPO_ID])?.isInvalidated).toBe(false)
      expect(await screen.findByText(mutationCase.toast)).toBeInTheDocument()
    },
  )

  it('integrates a branch into the target repo without invalidating either status cache', async () => {
    const { result, queryClient, fetchFake } = renderGit()
    queryClient.setQueryData(['gitStatus', 2], gitStatus)
    queryClient.setQueryData(['gitLog', 2], { commits: [] })
    queryClient.setQueryData(['fileDiff', 2], [])

    await act(async () => {
      await result.current.integrateBranch.mutateAsync({ targetBranch: 'main', strategy: 'merge' })
    })

    expect(fetchFake.lastRequest('POST', `/api/repos/${REPO_ID}/git/integrate`)?.body).toEqual({
      targetBranch: 'main',
      strategy: 'merge',
    })
    expect(fetchFake.findRequests('POST', `/api/repos/${REPO_ID}/git/integrate`)).toHaveLength(1)
    expect(queryClient.getQueryState(['gitStatus', REPO_ID])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['gitStatus', 2])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['reposGitStatus', [1, 2]])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['repos'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['gitLog', 2])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['fileDiff', 2])?.isInvalidated).toBe(true)
    expect(await screen.findByText('Integrated 1 commit into main')).toBeInTheDocument()
  })

  it.each([
    {
      name: 'applying a stash',
      run: async (git: GitHook) => { await git.stashApply.mutateAsync({ index: 0, hash: 'abc123', pop: false }) },
      path: `/api/repos/${REPO_ID}/git/stash/0/apply`,
      stashesInvalidated: true,
    },
    {
      name: 'continuing an operation',
      run: async (git: GitHook) => { await git.continueOperation.mutateAsync() },
      path: `/api/repos/${REPO_ID}/git/operation/continue`,
      stashesInvalidated: false,
    },
  ])('invalidates the working-tree state and reports the conflict when $name conflicts', async ({ run, path, stashesInvalidated }) => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(() => useGit(REPO_ID), {
      ...hookProviders,
      fetchRoutes: [
        {
          method: 'POST',
          path,
          respond: () => ({ status: 500, json: { error: 'CONFLICT (content): Merge conflict in file.txt' } }),
        },
      ],
    })
    queryClient.setQueryData(['gitStatus', REPO_ID], gitStatus)
    queryClient.setQueryData(['fileDiff', REPO_ID, 'file.txt', undefined], { path: 'file.txt', diff: 'cached' })
    queryClient.setQueryData(['gitStashes'], { stashes: [] })

    await act(async () => {
      await expect(run(result.current)).rejects.toThrow('CONFLICT (content): Merge conflict in file.txt')
    })

    expect(queryClient.getQueryState(['gitStatus', REPO_ID])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['fileDiff', REPO_ID, 'file.txt', undefined])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['gitStashes'])?.isInvalidated).toBe(stashesInvalidated)
    expect(fetchFake.findRequests('DELETE', `/api/repos/${REPO_ID}/git/stash/0`)).toHaveLength(0)
    expect(await screen.findByText('Merge conflict detected. Resolve conflicts before continuing.')).toBeInTheDocument()
    expect(screen.queryByText('Changes stashed')).toBeNull()
  })

  it('returns the generated commit message', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useGit(REPO_ID), {
      ...hookProviders,
      fetchRoutes: [
        {
          method: 'POST',
          path: `/api/repos/${REPO_ID}/git/commit-message`,
          respond: () => ({ json: { message: 'generated message' } }),
        },
      ],
    })

    await expect(result.current.generateCommitMessage.mutateAsync()).resolves.toEqual({
      message: 'generated message',
    })
    await waitFor(() => expect(fetchFake.findRequests('POST', `/api/repos/${REPO_ID}/git/commit-message`)).toHaveLength(1))
  })

  it.each(mutationCases)('shows the server failure message when $name fails', async (mutationCase) => {
    const { result } = renderHookWithProviders(() => useGit(REPO_ID), {
      ...hookProviders,
      fetchRoutes: [
        { method: mutationCase.method, path: mutationCase.path, respond: () => ({ status: 500, json: { error: 'boom' } }) },
      ],
    })

    await act(async () => {
      await expect(mutationCase.run(result.current)).rejects.toThrow('boom')
    })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
