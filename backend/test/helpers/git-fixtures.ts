import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { GitAuthService } from '../../src/services/git-auth'

export function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}

export function createCommittedRepo(repoPath: string, branch = 'main'): void {
  mkdirSync(repoPath, { recursive: true })
  git(['init', '-b', branch], repoPath)
  git(['config', 'user.email', 'test@test.com'], repoPath)
  git(['config', 'user.name', 'Test'], repoPath)
  git(['commit', '--allow-empty', '-m', 'init'], repoPath)
}

export function createOrigin(originPath: string, workPath: string, extraBranches: string[] = []): void {
  mkdirSync(originPath, { recursive: true })
  git(['init', '--bare', originPath])
  mkdirSync(workPath, { recursive: true })
  git(['init', '-b', 'main'], workPath)
  git(['config', 'user.email', 'test@test.com'], workPath)
  git(['config', 'user.name', 'Test'], workPath)
  git(['commit', '--allow-empty', '-m', 'init'], workPath)
  git(['remote', 'add', 'origin', originPath], workPath)
  git(['push', 'origin', 'main'], workPath)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], originPath)

  for (const branch of extraBranches) {
    git(['checkout', '-b', branch], workPath)
    git(['commit', '--allow-empty', '-m', branch], workPath)
    git(['push', 'origin', branch], workPath)
    git(['checkout', 'main'], workPath)
  }
}

export function cloneOrigin(originPath: string, clonePath: string): void {
  git(['clone', originPath, clonePath])
  git(['config', 'user.email', 'test@test.com'], clonePath)
  git(['config', 'user.name', 'Test'], clonePath)
}

let seq = 0

export function uniqueName(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function createGitAuthService(env: Record<string, string> = {}): GitAuthService {
  return {
    getGitEnvironment: () => env,
    getSSHEnvironment: () => ({}),
    setupSSHForRepoUrl: async () => false,
    cleanupSSHKey: async () => {},
  } as unknown as GitAuthService
}
