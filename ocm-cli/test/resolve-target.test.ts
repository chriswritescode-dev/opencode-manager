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
