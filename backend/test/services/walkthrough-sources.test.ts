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
import { readWalkthroughChanges } from '../../src/services/walkthrough-sources'
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

    const changes = await readAt(clone, { kind: 'pullRequest', number: 1, base: 'main' })

    expect(changes.map((entry) => entry.file)).toEqual(['pr.txt'])
    expect(changes[0]?.status).toBe('added')
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
