import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { resolveTarget, type TargetRepo } from '../src/resolve-target'

const LAST = {
  repoId: 99,
  name: 'last-repo',
  directory: '/manager/last',
  branch: 'main',
}

function gitInit(dir: string, originUrl?: string): void {
  mkdirSync(dir, { recursive: true })
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  if (originUrl) {
    spawnSync('git', ['remote', 'add', 'origin', originUrl], { cwd: dir, stdio: 'ignore' })
  }
}

describe('resolveTarget', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-target-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  const repo = (id: number, originUrl: string, name = `repo-${id}`): TargetRepo => ({
    repoId: id,
    name,
    branch: 'main',
    directory: `/manager/${name}`,
    originUrl,
  })

  it('returns cwd-match when $PWD origin matches exactly one Manager repo', () => {
    const dir = join(tmp, 'work')
    gitInit(dir, 'https://github.com/me/repo.git')

    const result = resolveTarget({
      cwd: dir,
      repos: [repo(1, 'https://github.com/me/repo.git', 'my-repo'), repo(2, 'https://github.com/other/repo.git')],
      last: LAST,
    })

    expect(result.kind).toBe('cwd-match')
    if (result.kind === 'cwd-match') {
      expect(result.repo.repoId).toBe(1)
      expect(result.repo.name).toBe('my-repo')
    }
  })

  it('returns cwd-ambiguous when multiple Manager repos match', () => {
    const dir = join(tmp, 'work')
    gitInit(dir, 'https://github.com/me/repo.git')

    const result = resolveTarget({
      cwd: dir,
      repos: [
        repo(1, 'https://github.com/me/repo.git', 'a'),
        repo(2, 'https://github.com/me/repo.git', 'b'),
      ],
      last: LAST,
    })

    expect(result.kind).toBe('cwd-ambiguous')
    if (result.kind === 'cwd-ambiguous') {
      expect(result.matches).toHaveLength(2)
    }
  })

  it('returns local(no-match) when in a git repo with no origin match (even if last is set)', () => {
    const dir = join(tmp, 'work')
    gitInit(dir, 'https://github.com/me/repo.git')

    const result = resolveTarget({
      cwd: dir,
      repos: [repo(1, 'https://github.com/other/repo.git')],
      last: LAST,
    })

    expect(result.kind).toBe('local')
    if (result.kind === 'local') {
      expect(result.reason).toBe('no-match')
      expect(result.repoRoot).toContain('work')
    }
  })

  it('returns last when not in a git repo and last is set', () => {
    const dir = join(tmp, 'not-git')
    mkdirSync(dir)

    const result = resolveTarget({
      cwd: dir,
      repos: [repo(1, 'https://github.com/me/repo.git')],
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
      repos: [repo(1, 'https://github.com/me/repo.git')],
    })

    expect(result.kind).toBe('local')
    if (result.kind === 'local') {
      expect(result.reason).toBe('no-target')
      expect(result.repoRoot).toBeNull()
    }
  })

  it('normalises .git suffix when matching origin', () => {
    const dir = join(tmp, 'work')
    gitInit(dir, 'https://github.com/me/repo')

    const result = resolveTarget({
      cwd: dir,
      repos: [repo(1, 'https://github.com/me/repo.git', 'my-repo')],
    })

    expect(result.kind).toBe('cwd-match')
  })
})
