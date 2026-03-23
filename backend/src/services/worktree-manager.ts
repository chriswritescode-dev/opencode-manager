import type { Repo } from '../types/repo'
import type { RepoMapping } from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import { execCommand } from '../utils/process'
import { mkdir, writeFile, symlink, access, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getReposPath, getWorkspacesPath, getSharedPath, getContainerWorkspacesPath } from '@opencode-manager/shared/config/env'

const REPOS_BASE_PATH = getReposPath()
const WORKSPACES_BASE_PATH = getWorkspacesPath()
const SHARED_BASE_PATH = getSharedPath()

export class WorktreeManager {
  async createWorktreeForSession(
    repo: Repo,
    sessionName: string,
    branch?: string
  ): Promise<RepoMapping> {
    const repoBasePath = path.join(REPOS_BASE_PATH, repo.localPath)
    const worktreePath = path.join(WORKSPACES_BASE_PATH, sessionName, repo.localPath)
    const sharedPath = path.join(repoBasePath, '.shared', sessionName)
    const sessionPath = path.join(WORKSPACES_BASE_PATH, sessionName)
    const sharedWorkspacePath = path.join(sessionPath, 'shared')

    logger.info(`Creating worktree for repo ${repo.localPath} in session ${sessionName}`)

    try {
      await mkdir(path.join(repoBasePath, '.shared'), { recursive: true })
      await mkdir(sessionPath, { recursive: true })
      await mkdir(sharedPath, { recursive: true })
      await mkdir(path.dirname(worktreePath), { recursive: true })
      logger.info(`Created shared directory: ${sharedPath}`)

      let targetBranch = branch || repo.defaultBranch
      if (!targetBranch) {
        targetBranch = await this.getDefaultBranch(repoBasePath)
      }
      if (!targetBranch) {
        targetBranch = 'main'
      }
      
      await this.runGit(repoBasePath, ['worktree', 'prune'])

      let baseRef = await this.resolveBaseRef(repoBasePath, targetBranch)
      const baseRefExists = await this.branchExists(repoBasePath, targetBranch)
      if (!baseRefExists) {
        const fallbackBranch = await this.getDefaultBranch(repoBasePath)
        if (fallbackBranch && fallbackBranch !== targetBranch) {
          targetBranch = fallbackBranch
          baseRef = await this.resolveBaseRef(repoBasePath, targetBranch)
        } else {
          const currentBranch = await this.getCurrentBranch(repoBasePath)
          if (currentBranch && currentBranch !== targetBranch) {
            targetBranch = currentBranch
            baseRef = await this.resolveBaseRef(repoBasePath, targetBranch)
          }
        }
      }
      const isCheckedOut = await this.isBranchCheckedOut(repoBasePath, targetBranch)
      const worktreeBranch = isCheckedOut
        ? this.buildWorktreeBranchName(sessionName, targetBranch)
        : targetBranch

      if (isCheckedOut) {
        await this.runGit(repoBasePath, ['worktree', 'add', '-b', worktreeBranch, worktreePath, baseRef])
        logger.info(`Created worktree at ${worktreePath} with new branch ${worktreeBranch}`)
      } else if (baseRef.startsWith('origin/')) {
        await this.runGit(repoBasePath, ['worktree', 'add', '-b', worktreeBranch, worktreePath, baseRef])
        logger.info(`Created worktree at ${worktreePath} with tracking branch ${worktreeBranch}`)
      } else {
        await this.runGit(repoBasePath, ['worktree', 'add', worktreePath, worktreeBranch])
        logger.info(`Created worktree at ${worktreePath} with existing branch ${worktreeBranch}`)
      }

      await this.ensureWorktreelinksConfig(repoBasePath, sessionName)

      await this.linkDependencies(repoBasePath, sessionName)

      await this.ensureSharedLinks(sharedWorkspacePath, repo.localPath)

    const repoMapping: RepoMapping = {
      repoId: repo.id,
      repoName: repo.localPath,
      worktreePath,
      symlinkPath: worktreePath,
      containerPath: path.posix.join(getContainerWorkspacesPath(), sessionName, repo.localPath),
      branch: worktreeBranch,
    }

      return repoMapping
    } catch (error) {
      logger.error(`Failed to create worktree for ${repo.localPath}:`, error)
      
      try {
        await this.runGit(repoBasePath, ['worktree', 'remove', '--force', worktreePath])
      } catch (cleanupError) {
        logger.warn(`Failed to cleanup worktree:`, cleanupError)
      }
      
      throw error
    }
  }

  async removeWorktree(repoLocalPath: string, sessionName: string): Promise<void> {
    const repoBasePath = path.join(REPOS_BASE_PATH, repoLocalPath)
    const worktreePath = path.join(WORKSPACES_BASE_PATH, sessionName, repoLocalPath)
    const sharedPath = path.join(repoBasePath, '.shared', sessionName)

    logger.info(`Removing worktree for repo ${repoLocalPath} in session ${sessionName}`)

    try {
      await this.runGit(repoBasePath, ['worktree', 'remove', '--force', worktreePath])
      logger.info(`Removed worktree: ${worktreePath}`)
    } catch (error) {
      logger.warn(`Failed to remove worktree (may not exist):`, error)
    }

    try {
      await execCommand(['rm', '-rf', sharedPath])
      logger.info(`Removed shared directory: ${sharedPath}`)
    } catch (error) {
      logger.warn(`Failed to remove shared directory:`, error)
    }

    try {
      await this.runGit(repoBasePath, ['worktree', 'prune'])
    } catch (error) {
      logger.warn(`Failed to prune worktrees:`, error)
    }
  }

  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = await this.runGit(repoPath, ['symbolic-ref', '--short', 'HEAD'])
      return result.trim()
    } catch {
      return null
    }
  }

  private async getDefaultBranch(repoPath: string): Promise<string | null> {
    try {
        const result = await this.runGit(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
        return result.trim().replace('origin/', '')
      } catch {
        try {
          const result = await this.runGit(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
          return result.trim().replace('refs/remotes/origin/', '')
        } catch {
        return 'main'
      }
    }
  }

  private async branchExists(repoPath: string, branch: string): Promise<boolean> {
    try {
        await this.runGit(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`])
        return true
      } catch {
        try {
          await this.runGit(repoPath, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
          return true
        } catch {
        return false
      }
    }
  }

  private async resolveBaseRef(repoPath: string, branch: string): Promise<string> {
    try {
      await this.runGit(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`])
      return branch
    } catch {
      try {
        await this.runGit(repoPath, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
        return `origin/${branch}`
      } catch {
        return branch
      }
    }
  }

  private async isBranchCheckedOut(repoPath: string, branch: string): Promise<boolean> {
    try {
      const output = await this.runGit(repoPath, ['worktree', 'list', '--porcelain'])
      const target = `refs/heads/${branch}`
      return output
        .split('\n')
        .some((line) => line.startsWith('branch ') && line.includes(target))
    } catch {
      return false
    }
  }

  private buildWorktreeBranchName(sessionName: string, baseBranch: string): string {
    const sanitizedSession = sessionName.replace(/[^A-Za-z0-9._-]/g, '-')
    const sanitizedBase = baseBranch.replace(/[^A-Za-z0-9._-]/g, '-')
    return `${sanitizedSession}-${sanitizedBase}`
  }

  private async runGit(repoPath: string, args: string[]): Promise<string> {
    if (existsSync(path.join(repoPath, '.git'))) {
      return execCommand(['git', '-C', repoPath, ...args])
    }
    return execCommand(['git', '--git-dir', repoPath, ...args])
  }

  private async ensureSharedLinks(sharedWorkspacePath: string, repoName: string): Promise<void> {
    await mkdir(sharedWorkspacePath, { recursive: true })

    const sharedRepoPath = path.join(SHARED_BASE_PATH, repoName)
    const sharedCommonPath = path.join(SHARED_BASE_PATH, 'common')

    await mkdir(sharedRepoPath, { recursive: true })
    await mkdir(sharedCommonPath, { recursive: true })

    await this.ensureRelativeSymlink(sharedRepoPath, path.join(sharedWorkspacePath, repoName))
    await this.ensureRelativeSymlink(sharedCommonPath, path.join(sharedWorkspacePath, 'common'))
  }

  private async ensureRelativeSymlink(targetPath: string, linkPath: string): Promise<void> {
    try {
      await access(linkPath)
      return
    } catch {
      const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
      await symlink(relativeTarget, linkPath, 'dir')
    }
  }

  private async ensureWorktreelinksConfig(repoPath: string, sessionName: string): Promise<void> {
    const worktreelinksPath = path.join(repoPath, '.worktreelinks')
    
    try {
      await access(worktreelinksPath)
      logger.info(`.worktreelinks already exists for ${repoPath}`)
    } catch {
      logger.info(`Creating default .worktreelinks for ${repoPath}`)
      await this.generateWorktreelinksConfig(repoPath)
    }
  }

  private async generateWorktreelinksConfig(repoPath: string): Promise<void> {
    const worktreelinksPath = path.join(repoPath, '.worktreelinks')
    
    const defaultConfig = `# Worktree-link configuration
# Shared dependencies and resources

# Node.js
../.shared/SESSION_NAME/node_modules
../.shared/SESSION_NAME/.npm
../.shared/SESSION_NAME/.pnpm-store
../.shared/SESSION_NAME/.yarn
../.shared/SESSION_NAME/.bun

# Python
../.shared/SESSION_NAME/venv
../.shared/SESSION_NAME/.venv
../.shared/SESSION_NAME/__pycache__

# Rust
../.shared/SESSION_NAME/target

# PHP
../.shared/SESSION_NAME/vendor

# Environment files
../.shared/SESSION_NAME/.env
../.shared/SESSION_NAME/.env.local

# Build caches
../.shared/SESSION_NAME/.cache
../.shared/SESSION_NAME/dist
../.shared/SESSION_NAME/build

# IDE settings (optional - comment out if you want per-worktree settings)
# .vscode/
# .idea/
`

    await writeFile(worktreelinksPath, defaultConfig, 'utf-8')
    logger.info(`Generated .worktreelinks at ${worktreelinksPath}`)
  }

  private async linkDependencies(repoPath: string, sessionName: string): Promise<void> {
    const worktreelinksPath = path.join(repoPath, '.worktreelinks')
    
    try {
      await access(worktreelinksPath)
    } catch {
      logger.info(`No .worktreelinks found, skipping dependency linking`)
      return
    }

    const worktreePath = path.join(WORKSPACES_BASE_PATH, sessionName, path.basename(repoPath))

    try {
      const configContent = await readFile(worktreelinksPath, 'utf-8')
      const processedConfig = configContent.replace(/SESSION_NAME/g, sessionName)
      const tempConfigPath = path.join(repoPath, `.worktreelinks.${sessionName}`)
      await writeFile(tempConfigPath, processedConfig, 'utf-8')

      await execCommand([
        'worktree-link',
        '--source', repoPath,
        '--target', worktreePath,
        '--config', tempConfigPath
      ])
      
      logger.info(`Linked dependencies for ${sessionName} using worktree-link`)

      try {
        await execCommand(['rm', tempConfigPath])
      } catch {
        // Ignore cleanup errors
      }
    } catch (error) {
      logger.warn(`Failed to link dependencies with worktree-link:`, error)
      logger.info(`You may need to install worktree-link: cargo install worktree-link`)
    }
  }

  async listWorktrees(repo: Repository): Promise<Array<{ path: string; branch: string }>> {
    const repoBasePath = path.join(REPOS_BASE_PATH, repo.localPath)

    try {
      const result = await this.runGit(repoBasePath, ['worktree', 'list', '--porcelain'])

      const worktrees: Array<{ path: string; branch: string }> = []
      const lines = result.split('\n')
      let currentWorktree: { path?: string; branch?: string } = {}

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree.path && currentWorktree.branch) {
            worktrees.push({
              path: currentWorktree.path,
              branch: currentWorktree.branch,
            })
          }
          currentWorktree = { path: line.substring(9) }
        } else if (line.startsWith('branch ')) {
          currentWorktree.branch = line.substring(7).replace('refs/heads/', '')
        }
      }

      if (currentWorktree.path && currentWorktree.branch) {
        worktrees.push({
          path: currentWorktree.path,
          branch: currentWorktree.branch,
        })
      }

      return worktrees.filter(wt => !wt.path.endsWith(repo.localPath))
    } catch (error) {
      logger.error(`Failed to list worktrees for ${repo.localPath}:`, error)
      return []
    }
  }
}
