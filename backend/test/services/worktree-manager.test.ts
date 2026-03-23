import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorktreeManager } from '../../src/services/worktree-manager'
import type { Repo } from '../../src/types/repo'
import { execCommand } from '../../src/utils/process'
import { mkdir, writeFile, readFile, access, symlink } from 'fs/promises'

vi.mock('../../src/utils/process', () => ({
  execCommand: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: () => '/workspace/repos',
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  access: vi.fn(),
  symlink: vi.fn().mockResolvedValue(undefined),
}))

describe('WorktreeManager', () => {
  let manager: WorktreeManager
  let repo: Repo

  beforeEach(() => {
    manager = new WorktreeManager()
    repo = {
      id: 1,
      localPath: 'repo-1',
      fullPath: '/workspace/repos/repo-1',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    }
    vi.clearAllMocks()
  })

  it('should create worktree using existing branch', async () => {
    vi.mocked(access)
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce(undefined)

    vi.mocked(readFile).mockResolvedValue('../.shared/SESSION_NAME/node_modules')

    vi.mocked(execCommand).mockImplementation(async (args: string[]) => {
      if (args.includes('rev-parse') && args.includes('--abbrev-ref') && args.includes('HEAD')) {
        return 'main'
      }
      if (args.includes('rev-parse') && args.includes('--abbrev-ref') && args.includes('origin/HEAD')) {
        return 'origin/main'
      }
      if (args.includes('rev-parse') && args.includes('--verify') && args.includes('refs/heads/feature')) {
        return ''
      }
      return ''
    })

    const mapping = await manager.createWorktreeForSession(repo, 'session-1', 'feature')

    expect(execCommand).toHaveBeenCalledWith([
      'git', '-C', '/workspace/repos/repo-1',
      'worktree', 'add', 'session-1', 'feature',
    ])
    expect(execCommand).toHaveBeenCalledWith([
      'worktree-link',
      '--source', '/workspace/repos/repo-1',
      '--target', '/workspace/repos/repo-1/session-1',
      '--config', '/workspace/repos/repo-1/.worktreelinks.session-1',
    ])
    expect(mkdir).toHaveBeenCalledWith('/workspace/sessions/session-1', { recursive: true })
    expect(symlink).toHaveBeenCalledWith(
      '/workspace/repos/repo-1/session-1',
      '/workspace/sessions/session-1/repo-1',
      'dir'
    )
    expect(mapping.repoId).toBe(1)
    expect(mapping.branch).toBe('feature')
  })

  it('should create worktree with new branch when missing', async () => {
    vi.mocked(access)
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce(undefined)

    vi.mocked(readFile).mockResolvedValue('../.shared/SESSION_NAME/node_modules')

    vi.mocked(execCommand).mockImplementation(async (args: string[]) => {
      if (args.includes('rev-parse') && args.includes('--abbrev-ref') && args.includes('HEAD')) {
        return 'main'
      }
      if (args.includes('rev-parse') && args.includes('--abbrev-ref') && args.includes('origin/HEAD')) {
        return 'origin/main'
      }
      if (args.includes('rev-parse') && args.includes('--verify')) {
        throw new Error('missing')
      }
      return ''
    })

    await manager.createWorktreeForSession(repo, 'session-2', 'new-branch')

    expect(execCommand).toHaveBeenCalledWith([
      'git', '-C', '/workspace/repos/repo-1',
      'worktree', 'add', '-b', 'new-branch', 'session-2',
    ])
  })

  it('should remove worktree and shared directory', async () => {
    vi.mocked(execCommand).mockResolvedValue('')

    await manager.removeWorktree('repo-1', 'session-1')

    expect(execCommand).toHaveBeenCalledWith([
      'git', '-C', '/workspace/repos/repo-1',
      'worktree', 'remove', '--force', 'session-1',
    ])
    expect(execCommand).toHaveBeenCalledWith([
      'rm', '-rf', '/workspace/repos/repo-1/.shared/session-1',
    ])
    expect(execCommand).toHaveBeenCalledWith([
      'git', '-C', '/workspace/repos/repo-1',
      'worktree', 'prune',
    ])
  })

  it('should list non-base worktrees', async () => {
    vi.mocked(execCommand).mockResolvedValue(
      [
        'worktree /workspace/repos/repo-1',
        'branch refs/heads/main',
        'worktree /workspace/repos/repo-1/session-1',
        'branch refs/heads/feature',
        'worktree /workspace/repos/repo-1/session-2',
        'branch refs/heads/bugfix',
      ].join('\n')
    )

    const worktrees = await manager.listWorktrees(repo)

    expect(worktrees).toHaveLength(2)
    expect(worktrees[0]?.branch).toBe('feature')
    expect(worktrees[1]?.branch).toBe('bugfix')
  })
})
