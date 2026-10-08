import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  parseWalkthroughSourceKey,
  walkthroughSourceKey,
} from '@opencode-manager/shared/schemas'
import { ChangeWalkthroughError } from '../../src/services/change-walkthrough-error'
import {
  planPullRequestFetch,
  readWalkthroughChanges,
  walkthroughPullRequestRef,
} from '../../src/services/walkthrough-sources'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { cloneOrigin, createCommittedRepo, createOrigin, git, uniqueName } from '../helpers/git-fixtures'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'walkthrough-sources-'))
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = '/dev/null'

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

function repoPath(prefix: string): string {
  return path.join(workspaceRoot, uniqueName(prefix))
}

function sessionAt(directory: string): SessionInfo {
  return { id: 'ses_test', title: 'Test', location: { directory } } as SessionInfo
}

function readAt(directory: string, source: WalkthroughSource): Promise<FileDiffInfo[]> {
  return readWalkthroughChanges({
    client: {} as OpenCodeClient,
    session: sessionAt(directory),
    source,
    gitEnv: GIT_ENV,
  })
}

describe('readWalkthroughChanges', () => {
  it('delegates the session source to the session diff', async () => {
    const changes: FileDiffInfo[] = [
      { file: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1, status: 'modified' },
    ]
    const client = {
      api: {
        message: { list: vi.fn(async () => ({ data: [{ id: 'msg-1' }], cursor: {} })) },
        session: { diff: vi.fn(async () => changes) },
      },
    } as unknown as OpenCodeClient

    const result = await readWalkthroughChanges({
      client,
      session: sessionAt('/not/a/repo'),
      source: DEFAULT_WALKTHROUGH_SOURCE,
      gitEnv: GIT_ENV,
    })

    expect(result).toEqual(changes)
  })

  it('reports staged-only edits only in staged', async () => {
    const repo = repoPath('staged')
    createCommittedRepo(repo)
    writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    git(['add', 'a.txt'], repo)
    git(['commit', '-m', 'add a'], repo)
    writeFileSync(path.join(repo, 'a.txt'), 'two\n')
    git(['add', 'a.txt'], repo)

    const staged = await readAt(repo, { kind: 'staged' })
    const unstaged = await readAt(repo, { kind: 'unstaged' })
    const uncommitted = await readAt(repo, { kind: 'uncommitted' })

    expect(staged.map((entry) => entry.file)).toEqual(['a.txt'])
    expect(staged[0]?.status).toBe('modified')
    expect(unstaged).toEqual([])
    expect(uncommitted.map((entry) => entry.file)).toEqual(['a.txt'])
  })

  it('reports an untracked file as added in uncommitted and unstaged', async () => {
    const repo = repoPath('untracked')
    createCommittedRepo(repo)
    writeFileSync(path.join(repo, 'new.txt'), 'hello\n')

    const uncommitted = await readAt(repo, { kind: 'uncommitted' })
    const unstaged = await readAt(repo, { kind: 'unstaged' })

    expect(uncommitted).toHaveLength(1)
    expect(uncommitted[0]).toMatchObject({ file: 'new.txt', status: 'added', additions: 1, deletions: 0 })
    expect(unstaged.map((entry) => entry.file)).toEqual(['new.txt'])
    expect(unstaged[0]?.status).toBe('added')
  })

  it('parses untracked paths with spaces and non-ASCII characters', async () => {
    const repo = repoPath('special-names')
    createCommittedRepo(repo)
    writeFileSync(path.join(repo, 'my file.txt'), 'hello\n')
    writeFileSync(path.join(repo, 'é.txt'), 'bonjour\n')

    const unstaged = await readAt(repo, { kind: 'unstaged' })

    expect(unstaged.map((entry) => entry.file).sort()).toEqual(['my file.txt', 'é.txt'])
  })

  it('reports branch commits against the base', async () => {
    const repo = repoPath('branch')
    createCommittedRepo(repo, 'main')
    git(['checkout', '-b', 'feature'], repo)
    writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], repo)
    git(['commit', '-m', 'feature'], repo)

    const explicit = await readAt(repo, { kind: 'branch', base: 'main' })
    const resolved = await readAt(repo, { kind: 'branch' })

    expect(explicit.map((entry) => entry.file)).toEqual(['feature.txt'])
    expect(explicit[0]?.status).toBe('added')
    expect(resolved.map((entry) => entry.file)).toEqual(['feature.txt'])
  })

  it('reports a pull request ref pushed to the origin', async () => {
    const origin = repoPath('origin')
    const work = repoPath('work')
    const clone = repoPath('clone')
    createOrigin(origin, work)
    cloneOrigin(origin, clone)

    git(['checkout', '-b', 'feature'], clone)
    writeFileSync(path.join(clone, 'pr.txt'), 'pr\n')
    git(['add', 'pr.txt'], clone)
    git(['commit', '-m', 'pr'], clone)
    git(['push', 'origin', 'HEAD:refs/pull/1/head'], clone)
    git(['fetch', 'origin', `+refs/pull/1/head:${walkthroughPullRequestRef(1)}`], clone)

    const changes = await readAt(clone, { kind: 'pullRequest', number: 1, base: 'main' })

    expect(changes.map((entry) => entry.file)).toEqual(['pr.txt'])
    expect(changes[0]?.status).toBe('added')
  })

  it('does not fetch the pull request ref when reading changes', async () => {
    const origin = repoPath('pr-no-fetch-origin')
    const work = repoPath('pr-no-fetch-work')
    const clone = repoPath('pr-no-fetch-clone')
    createOrigin(origin, work)
    cloneOrigin(origin, clone)

    git(['checkout', '-b', 'feature'], clone)
    writeFileSync(path.join(clone, 'pr.txt'), 'pr\n')
    git(['add', 'pr.txt'], clone)
    git(['commit', '-m', 'pr'], clone)
    git(['push', 'origin', 'HEAD:refs/pull/1/head'], clone)

    const error = await readAt(clone, { kind: 'pullRequest', number: 1, base: 'main' }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ChangeWalkthroughError)
    expect(error).toMatchObject({ status: 502, code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  })

  it('prefers the upstream remote when it exists', async () => {
    const repo = repoPath('pr-upstream')
    createCommittedRepo(repo)
    git(['remote', 'add', 'origin', 'https://example.com/base.git'], repo)
    git(['remote', 'add', 'upstream', 'https://example.com/fork.git'], repo)

    const plan = await planPullRequestFetch(repo, { kind: 'pullRequest', number: 7, base: 'main' })

    expect(plan.remote).toBe('upstream')
    expect(plan.refspec).toBe('+refs/pull/7/head:refs/ocm-walkthrough/pr/7')
    expect(plan.ref).toBe('refs/ocm-walkthrough/pr/7')
  })

  it('falls back to the origin remote when no upstream exists', async () => {
    const repo = repoPath('pr-origin')
    createCommittedRepo(repo)
    git(['remote', 'add', 'origin', 'https://example.com/base.git'], repo)

    const plan = await planPullRequestFetch(repo, { kind: 'pullRequest', number: 3, base: 'main' })

    expect(plan.remote).toBe('origin')
    expect(plan.refspec).toBe('+refs/pull/3/head:refs/ocm-walkthrough/pr/3')
  })

  it('excludes untracked files from staged and branch sources', async () => {
    const repo = repoPath('not-untracked')
    createCommittedRepo(repo, 'main')
    git(['checkout', '-b', 'feature'], repo)
    writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], repo)
    git(['commit', '-m', 'feature'], repo)
    writeFileSync(path.join(repo, 'loose.txt'), 'loose\n')

    const staged = await readAt(repo, { kind: 'staged' })
    const branch = await readAt(repo, { kind: 'branch', base: 'main' })

    expect(staged).toEqual([])
    expect(branch.map((entry) => entry.file)).toEqual(['feature.txt'])
  })

  it('rejects a non-git directory with a 409 source error', async () => {
    const dir = repoPath('plain')
    mkdirSync(dir, { recursive: true })

    const error = await readAt(dir, { kind: 'staged' }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ChangeWalkthroughError)
    expect(error).toMatchObject({ status: 409, code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  })

  it('rejects a branch source when no base branch exists', async () => {
    const repo = repoPath('nobase')
    createCommittedRepo(repo, 'trunk')

    const error = await readAt(repo, { kind: 'branch' }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ChangeWalkthroughError)
    expect(error).toMatchObject({ status: 409, code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  })

  it('resolves a base branch that only exists as a remote-tracking ref', async () => {
    const origin = repoPath('base-origin')
    const work = repoPath('base-work')
    const clone = repoPath('base-clone')
    createOrigin(origin, work, ['develop'])
    cloneOrigin(origin, clone)

    git(['checkout', '-b', 'feature'], clone)
    writeFileSync(path.join(clone, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], clone)
    git(['commit', '-m', 'feature'], clone)

    const changes = await readAt(clone, { kind: 'branch', base: 'develop' })

    expect(changes.map((entry) => entry.file)).toEqual(['feature.txt'])
  })

  it('rejects a branch source when the diff fails after the base resolves', async () => {
    const repo = repoPath('diff-failure')
    mkdirSync(repo, { recursive: true })
    git(['init', '-b', 'main'], repo)
    git(['config', 'user.email', 'test@test.com'], repo)
    git(['config', 'user.name', 'Test'], repo)
    writeFileSync(path.join(repo, 'base.txt'), 'base\n')
    git(['add', 'base.txt'], repo)
    git(['commit', '-m', 'base'], repo)
    git(['checkout', '-b', 'feature'], repo)
    writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], repo)
    git(['commit', '-m', 'feature'], repo)

    const tree = git(['rev-parse', 'main^{tree}'], repo)
    rmSync(path.join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true })

    const error = await readAt(repo, { kind: 'branch', base: 'main' }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ChangeWalkthroughError)
    expect(error).toMatchObject({ status: 502, code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
    expect((error as Error).message).toContain('unable to read tree')
  })

  it('reads root-relative paths when diff prefix config changes the header', async () => {
    for (const [key, value] of [['diff.mnemonicPrefix', 'true'], ['diff.noprefix', 'true']]) {
      const repo = repoPath(`prefix-${key}`)
      createCommittedRepo(repo)
      writeFileSync(path.join(repo, 'tracked.txt'), 'one\n')
      git(['add', 'tracked.txt'], repo)
      git(['commit', '-m', 'add tracked'], repo)
      writeFileSync(path.join(repo, 'tracked.txt'), 'two\n')
      writeFileSync(path.join(repo, 'untracked.txt'), 'new\n')
      git(['config', key!, value!], repo)

      const unstaged = await readAt(repo, { kind: 'unstaged' })

      expect(unstaged.map((entry) => entry.file).sort()).toEqual(['tracked.txt', 'untracked.txt'])
      expect(unstaged.find((entry) => entry.file === 'tracked.txt')?.patch).toContain('-one')
      expect(unstaged.find((entry) => entry.file === 'untracked.txt')?.status).toBe('added')
    }
  })

  it('ignores an external diff driver for tracked and untracked files', async () => {
    const repo = repoPath('external-diff')
    createCommittedRepo(repo)
    writeFileSync(path.join(repo, 'tracked.txt'), 'one\n')
    git(['add', 'tracked.txt'], repo)
    git(['commit', '-m', 'add tracked'], repo)
    writeFileSync(path.join(repo, 'tracked.txt'), 'two\n')
    writeFileSync(path.join(repo, 'untracked.txt'), 'new\n')
    git(['config', 'diff.external', 'false'], repo)

    const unstaged = await readAt(repo, { kind: 'unstaged' })

    expect(unstaged.map((entry) => entry.file).sort()).toEqual(['tracked.txt', 'untracked.txt'])
  })

  it('reads unstaged worktree edits and uncommitted content without a HEAD commit', async () => {
    const repo = repoPath('no-head')
    mkdirSync(repo, { recursive: true })
    git(['init', '-b', 'main'], repo)
    git(['config', 'user.email', 'test@test.com'], repo)
    git(['config', 'user.name', 'Test'], repo)
    writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    git(['add', 'a.txt'], repo)
    writeFileSync(path.join(repo, 'a.txt'), 'two\n')

    const unstaged = await readAt(repo, { kind: 'unstaged' })
    const uncommitted = await readAt(repo, { kind: 'uncommitted' })

    expect(unstaged.map((entry) => entry.file)).toEqual(['a.txt'])
    expect(unstaged[0]?.patch).toContain('-one')
    expect(unstaged[0]?.patch).toContain('+two')
    expect(uncommitted.map((entry) => entry.file)).toEqual(['a.txt'])
    expect(uncommitted[0]?.patch).toContain('+two')
    expect(uncommitted[0]?.patch).not.toContain('+one')
  })

  it('includes every untracked file in a single uncommitted read', async () => {
    const repo = repoPath('many-untracked')
    createCommittedRepo(repo)
    mkdirSync(path.join(repo, 'nested'), { recursive: true })
    writeFileSync(path.join(repo, 'b.txt'), 'b\n')
    writeFileSync(path.join(repo, 'a.txt'), 'a\n')
    writeFileSync(path.join(repo, 'nested', 'c.txt'), 'c\n')

    const uncommitted = await readAt(repo, { kind: 'uncommitted' })

    expect(uncommitted.map((entry) => entry.file).sort()).toEqual(['a.txt', 'b.txt', 'nested/c.txt'])
    expect(uncommitted.every((entry) => entry.status === 'added')).toBe(true)
  })

  it('rejects a diff larger than the output cap with a 413 error', async () => {
    const repo = repoPath('too-large')
    createCommittedRepo(repo)
    writeFileSync(path.join(repo, 'huge.txt'), 'x'.repeat(6_000_000))

    const error = await readAt(repo, { kind: 'unstaged' }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(ChangeWalkthroughError)
    expect(error).toMatchObject({ status: 413, code: 'WALKTHROUGH_DIFF_TOO_LARGE' })
  })
})

describe('walkthroughSourceKey', () => {
  it('round-trips every source kind', () => {
    const sources: WalkthroughSource[] = [
      { kind: 'session' },
      { kind: 'uncommitted' },
      { kind: 'staged' },
      { kind: 'unstaged' },
      { kind: 'branch' },
      { kind: 'branch', base: 'develop' },
      { kind: 'pullRequest', number: 12 },
      { kind: 'pullRequest', number: 12, base: 'develop' },
    ]

    for (const source of sources) {
      expect(parseWalkthroughSourceKey(walkthroughSourceKey(source))).toEqual(source)
    }
  })

  it('rejects invalid keys', () => {
    expect(parseWalkthroughSourceKey('branch:-x')).toBeNull()
    expect(parseWalkthroughSourceKey('pr:0:')).toBeNull()
    expect(parseWalkthroughSourceKey('pr:abc:main')).toBeNull()
    expect(parseWalkthroughSourceKey('nonsense')).toBeNull()
  })
})
