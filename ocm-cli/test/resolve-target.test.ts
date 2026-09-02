import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { resolveTarget, formatRepoIdentity, formatRepoIdentities, parseRepoIdPositional, restrictMatchesToRequestedRepo, type TargetRepo, type RepoIdentity } from '../src/resolve-target'
import type { RemoteRepoSummary } from '../src/mirror'

const LAST = {
  repoId: 99,
  name: 'last-repo',
  directory: '/manager/last',
  branch: 'main',
}

function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true })
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
}

describe('resolveTarget', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-target-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  const repo = (id: number, projectId: string, name = `repo-${id}`): TargetRepo => ({
    repoId: id,
    name,
    branch: 'main',
    directory: `/manager/${name}`,
    projectId,
  })

  it('returns cwd-match when local project id matches exactly one Manager repo', () => {
    const dir = join(tmp, 'work')
    gitInit(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: 'project-a',
      repos: [repo(1, 'project-a', 'my-repo'), repo(2, 'project-b')],
      last: LAST,
    })

    expect(result.kind).toBe('cwd-match')
    if (result.kind === 'cwd-match') {
      expect(result.repo.repoId).toBe(1)
      expect(result.repo.name).toBe('my-repo')
    }
  })

  it('returns cwd-ambiguous when multiple Manager repos share the project id', () => {
    const dir = join(tmp, 'work')
    gitInit(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: 'project-a',
      repos: [repo(1, 'project-a', 'a'), repo(2, 'project-a', 'b')],
      last: LAST,
    })

    expect(result.kind).toBe('cwd-ambiguous')
    if (result.kind === 'cwd-ambiguous') {
      expect(result.matches).toHaveLength(2)
      expect(result.localProjectId).toBe('project-a')
    }
  })

  it('returns local(no-match) in a git repo when no project id matches (even if last is set)', () => {
    const dir = join(tmp, 'work')
    gitInit(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: 'project-a',
      repos: [repo(1, 'project-b')],
      last: LAST,
    })

    expect(result.kind).toBe('local')
    if (result.kind === 'local') {
      expect(result.reason).toBe('no-match')
      expect(result.repoRoot).toContain('work')
    }
  })

  it('returns local(no-match) in a git repo when the local project id cannot be resolved', () => {
    const dir = join(tmp, 'work')
    gitInit(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: null,
      repos: [repo(1, 'project-a')],
      last: LAST,
    })

    expect(result.kind).toBe('local')
    if (result.kind === 'local') {
      expect(result.reason).toBe('no-match')
    }
  })

  it('returns last when not in a git repo and last is set', () => {
    const dir = join(tmp, 'not-git')
    mkdirSync(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: null,
      repos: [repo(1, 'project-a')],
      last: LAST,
    })

    expect(result.kind).toBe('last')
    if (result.kind === 'last') {
      expect(result.repo.repoId).toBe(LAST.repoId)
    }
  })

  it('returns local(no-target) when not in a git repo and no last', () => {
    const dir = join(tmp, 'not-git')
    mkdirSync(dir)

    const result = resolveTarget({
      cwd: dir,
      localProjectId: null,
      repos: [repo(1, 'project-a')],
    })

    expect(result.kind).toBe('local')
    if (result.kind === 'local') {
      expect(result.reason).toBe('no-target')
      expect(result.repoRoot).toBeNull()
    }
  })
})

describe('formatRepoIdentities', () => {
  it('shows id, kind, branch, and path for a worktree and a base repo', () => {
    const worktree = {
      repoId: 3,
      name: 'my-app-feat-x',
      branch: 'feat/x',
      isWorktree: true,
      directory: '/repos/my-app-feat-x',
    }
    const base = {
      repoId: 2,
      name: 'my-app',
      branch: null,
      directory: '/repos/my-app',
    }

    expect(formatRepoIdentity(worktree)).toBe('my-app-feat-x (id=3, worktree, branch=feat/x, path=/repos/my-app-feat-x)')
    expect(formatRepoIdentity(base)).toBe('my-app (id=2, repo, branch=n/a, path=/repos/my-app)')
    expect(formatRepoIdentities([worktree, base])).toBe(
      'my-app-feat-x (id=3, worktree, branch=feat/x, path=/repos/my-app-feat-x), my-app (id=2, repo, branch=n/a, path=/repos/my-app)',
    )
  })

  it('accepts readonly identity arrays', () => {
    const identities: readonly RepoIdentity[] = [
      { repoId: 1, name: 'a', branch: 'main', isWorktree: false, directory: '/repos/a' },
    ]
    expect(formatRepoIdentities(identities)).toBe('a (id=1, repo, branch=main, path=/repos/a)')
  })

  it('formats cwd-ambiguous target matches with worktree metadata included', () => {
    const ambiguous: readonly TargetRepo[] = [
      { repoId: 1, name: 'a', branch: 'main', directory: '/repos/a', isWorktree: false },
      { repoId: 2, name: 'b', branch: 'feat', directory: '/repos/b', isWorktree: true },
    ]
    const formatted = formatRepoIdentities(ambiguous)
    expect(formatted).toContain('a (id=1, repo, branch=main, path=/repos/a)')
    expect(formatted).toContain('b (id=2, worktree, branch=feat, path=/repos/b)')
  })
})

describe('parseRepoIdPositional', () => {
  const flags = ['--force', '--create', '--yes', '--full']

  it('returns null when no positional repo id is given and ignores known flags', () => {
    expect(parseRepoIdPositional([], flags)).toEqual({ repoId: null })
    expect(parseRepoIdPositional(['--force', '--full'], flags)).toEqual({ repoId: null })
  })

  it('parses a single positive integer repo id among flags', () => {
    expect(parseRepoIdPositional(['--force', '7', '--full'], flags)).toEqual({ repoId: 7 })
    expect(parseRepoIdPositional(['3'], flags)).toEqual({ repoId: 3 })
  })

  it('rejects non-positive-integer repo ids', () => {
    expect(parseRepoIdPositional(['abc'], flags).error).toMatch(/invalid repo id: abc/)
    expect(parseRepoIdPositional(['0'], flags).error).toMatch(/invalid repo id: 0/)
    expect(parseRepoIdPositional(['1.5'], flags).error).toMatch(/invalid repo id/)
    expect(parseRepoIdPositional(['1e3'], flags).error).toMatch(/invalid repo id/)
  })

  it('rejects oversized repo ids that are not safe integers', () => {
    expect(parseRepoIdPositional(['9007199254740993'], flags).error).toMatch(/invalid repo id: 9007199254740993/)
    expect(parseRepoIdPositional(['99999999999999999999'], flags).error).toMatch(/invalid repo id: 99999999999999999999/)
  })

  it('rejects unknown options', () => {
    expect(parseRepoIdPositional(['--bogus'], flags).error).toBe('unknown option: --bogus')
    expect(parseRepoIdPositional(['-x'], flags).error).toBe('unknown option: -x')
  })

  it('rejects duplicate positional repo ids', () => {
    expect(parseRepoIdPositional(['3', '4'], flags).error).toMatch(/multiple repo ids given: 3 and 4/)
  })
})

describe('restrictMatchesToRequestedRepo', () => {
  const match = (id: number): RemoteRepoSummary => ({
    repoId: id,
    name: `repo-${id}`,
    projectId: 'project-a',
    branch: 'main',
  })

  it('passes matches through when no repo id is requested', () => {
    const matches = [match(1), match(2)]
    expect(restrictMatchesToRequestedRepo(matches, null, 'project-a')).toEqual({ matches })
  })

  it('restricts matches to the exact requested repo', () => {
    const result = restrictMatchesToRequestedRepo([match(1), match(2)], 2, 'project-a')
    expect(result.error).toBeUndefined()
    expect(result.matches).toEqual([match(2)])
  })

  it('fails clearly when the requested repo is not one of the project matches', () => {
    const result = restrictMatchesToRequestedRepo([match(1), match(2)], 7, 'project-a')
    expect(result.error).toContain('repo 7 does not match project project-a')
    expect(result.error).toContain('repo-1 (id=1, repo, branch=main')
    expect(result.matches).toEqual([])
  })

  it('fails clearly when no repo matches the project', () => {
    const result = restrictMatchesToRequestedRepo([], 7, 'project-a')
    expect(result.error).toBe('repo 7 does not match project project-a; no Manager repo matches this project')
    expect(result.matches).toEqual([])
  })
})
