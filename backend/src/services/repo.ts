import { executeCommand } from '../utils/process'
import { ensureDirectoryExists } from './file-operations'
import * as db from '../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { logger } from '../utils/logger'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from './git-auth'
import { isGitHubHttpsUrl, isSSHUrl, normalizeSSHUrl } from '../utils/git-auth'
import path from 'path'
import { parseSSHHost } from '../utils/ssh-key-manager'
import { getErrorMessage } from '../utils/error-utils'

const GIT_CLONE_TIMEOUT = 300000

function enhanceCloneError(error: unknown, repoUrl: string, originalMessage: string): Error {
  const message = originalMessage.toLowerCase()
  
  if (message.includes('authentication failed') || message.includes('could not authenticate') || message.includes('invalid credentials')) {
    return new Error(`Authentication failed for ${repoUrl}. Please add your credentials in Settings > Git Credentials.`)
  }
  
  if (message.includes('repository not found') || message.includes('404')) {
    return new Error(`Repository not found: ${repoUrl}. Check the URL and ensure you have access to it.`)
  }
  
  if (isSSHUrl(repoUrl) && message.includes('permission denied')) {
    return new Error(`Access denied to ${repoUrl}. Please add your SSH credentials in Settings > Git Credentials and ensure your SSH key has access to this repository.`)
  }
  
  if (isGitHubHttpsUrl(repoUrl) && (message.includes('permission denied') || message.includes('fatal'))) {
    return new Error(`Access denied to ${repoUrl}. Please add your credentials in Settings > Git Credentials and ensure you have proper access.`)
  }
  
  if (message.includes('timed out')) {
    return new Error(`Clone timed out for ${repoUrl}. The repository might be too large or there could be network issues. Try again or verify the repository exists.`)
  }
  
  return error instanceof Error ? error : new Error(originalMessage)
}

async function hasCommits(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { env, silent: true })
    return true
  } catch {
    return false
  }
}

async function isValidGitRepo(repoPath: string, env: Record<string, string>): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--git-dir'], { env, silent: true })
    return true
  } catch {
    return false
  }
}

async function checkRepoNameAvailable(name: string): Promise<boolean> {
  const reposPath = getReposPath()
  const targetPath = path.join(reposPath, name)
  try {
    await executeCommand(['test', '-e', targetPath], { silent: true })
    return false
  } catch {
    return true
  }
}

async function copyRepoToWorkspace(sourcePath: string, targetName: string, env: Record<string, string>): Promise<void> {
  const reposPath = getReposPath()
  const targetPath = path.join(reposPath, targetName)
  
  logger.info(`Copying repo from ${sourcePath} to ${targetPath}`)
  await executeCommand(['git', 'clone', '--bare', '--local', sourcePath, targetName], { cwd: reposPath, env })
  logger.info(`Successfully copied repo to ${targetPath}`)
}


async function safeGetCurrentBranch(repoPath: string, env: Record<string, string>): Promise<string | null> {
  try {
    const repoHasCommits = await hasCommits(repoPath, env)
    if (!repoHasCommits) {
      try {
        const symbolicRef = await executeCommand(['git', '-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { env, silent: true })
        return symbolicRef.trim()
      } catch {
        return null
      }
    }
    const currentBranch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { env, silent: true })
    return currentBranch.trim()
  } catch {
    return null
  }
}

async function checkoutBranchSafely(repoPath: string, branch: string, env: Record<string, string>): Promise<void> {
  const sanitizedBranch = branch
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^origin\//, '')

  let localBranchExists = false
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/heads/${sanitizedBranch}`], { env, silent: true })
    localBranchExists = true
  } catch {
    localBranchExists = false
  }

  let remoteBranchExists = false
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/remotes/origin/${sanitizedBranch}`], { env, silent: true })
    remoteBranchExists = true
  } catch {
    remoteBranchExists = false
  }

  if (localBranchExists) {
    logger.info(`Checking out existing local branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', sanitizedBranch], { env })
  } else if (remoteBranchExists) {
    logger.info(`Checking out remote branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch, `origin/${sanitizedBranch}`], { env })
  } else {
    logger.info(`Creating new branch: ${sanitizedBranch}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch], { env })
  }
}

export async function initLocalRepo(
  database: Database,
  gitAuthService: GitAuthService,
  localPath: string,
  branch?: string
): Promise<Repo> {
  const normalizedInputPath = localPath.trim().replace(/\/+$/, '')
  const env = gitAuthService.getGitEnvironment()
  
  let targetPath: string
  let repoLocalPath: string
  let sourceWasGitRepo = false
  
  if (path.isAbsolute(normalizedInputPath)) {
    logger.info(`Absolute path detected: ${normalizedInputPath}`)
    
    try {
      const exists = await executeCommand(['test', '-d', normalizedInputPath], { silent: true })
        .then(() => true)
        .catch(() => false)
      
      if (!exists) {
        throw new Error(`No such file or directory: '${normalizedInputPath}'`)
      }
      
      const isGit = await isValidGitRepo(normalizedInputPath, env)
      
      if (isGit) {
        sourceWasGitRepo = true
        const baseName = path.basename(normalizedInputPath)
        
        const isAvailable = await checkRepoNameAvailable(baseName)
        if (!isAvailable) {
          throw new Error(`A repository named '${baseName}' already exists in the workspace. Please remove it first or use a different source directory.`)
        }
        
        repoLocalPath = baseName
        
        logger.info(`Copying existing git repo from ${normalizedInputPath} to workspace as ${baseName}`)
        await copyRepoToWorkspace(normalizedInputPath, baseName, env)
        targetPath = path.join(getReposPath(), baseName)
      } else {
        throw new Error(`Directory exists but is not a valid Git repository. Please provide either a Git repository path or a simple directory name to create a new empty repository.`)
      }
    } catch (error: unknown) {
      if (getErrorMessage(error).includes('No such file or directory')) {
        throw error
      }
      throw new Error(`Failed to process absolute path '${normalizedInputPath}': ${getErrorMessage(error)}`)
    }
  } else {
    repoLocalPath = normalizedInputPath
    targetPath = path.join(getReposPath(), repoLocalPath)
  }
  
  const existing = db.getRepoByLocalPath(database, repoLocalPath)
  if (existing) {
    logger.info(`Local repo already exists in database: ${repoLocalPath}`)
    return existing
  }
  
  const createRepoInput: CreateRepoInput = {
    localPath: repoLocalPath,
    branch: branch || undefined,
    defaultBranch: branch || 'main',
    cloneStatus: 'cloning',
    clonedAt: Date.now(),
    isLocal: true,
  }
  
  let repo: Repo
  let directoryCreated = false
  
  try {
    repo = db.createRepo(database, createRepoInput)
    logger.info(`Created database record for local repo: ${repoLocalPath} (id: ${repo.id})`)
  } catch (error: unknown) {
    logger.error(`Failed to create database record for local repo: ${repoLocalPath}`, error)
    throw new Error(`Failed to register local repository '${repoLocalPath}': ${getErrorMessage(error)}`)
  }
  
  try {
    if (!sourceWasGitRepo) {
      await ensureDirectoryExists(targetPath)
      directoryCreated = true
      logger.info(`Created directory for local repo: ${targetPath}`)
      
      logger.info(`Initializing git repository: ${targetPath}`)
      await executeCommand(['git', 'init', '--bare'], { cwd: targetPath })
      
      if (branch && branch !== 'main') {
        await executeCommand(['git', '-C', targetPath, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`])
      }
    } else {
      if (branch) {
        logger.info(`Switching to branch ${branch} for copied repo`)
        const currentBranch = await safeGetCurrentBranch(targetPath, env)
        
        if (currentBranch !== branch) {
          await checkoutBranchSafely(targetPath, branch, env)
        }
      }
    }
    
    const isGitRepo = await executeCommand(['git', '-C', targetPath, 'rev-parse', '--git-dir'])
      .then(() => true)
      .catch(() => false)
    
    if (!isGitRepo) {
      throw new Error(`Git initialization failed - directory exists but is not a valid git repository`)
    }
    
    db.updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Local git repo ready: ${repoLocalPath}`)
    return { ...repo, cloneStatus: 'ready' }
  } catch (error: unknown) {
    logger.error(`Failed to initialize local repo, rolling back: ${repoLocalPath}`, error)
    
    try {
      db.deleteRepo(database, repo.id)
      logger.info(`Rolled back database record for repo id: ${repo.id}`)
    } catch (dbError: unknown) {
      logger.error(`Failed to rollback database record for repo id ${repo.id}:`, getErrorMessage(dbError))
    }
    
    if (directoryCreated && !sourceWasGitRepo) {
      try {
        await executeCommand(['rm', '-rf', repoLocalPath], getReposPath())
        logger.info(`Rolled back directory: ${repoLocalPath}`)
      } catch (fsError: unknown) {
        logger.error(`Failed to rollback directory ${repoLocalPath}:`, getErrorMessage(fsError))
      }
    } else if (sourceWasGitRepo) {
      try {
        await executeCommand(['rm', '-rf', repoLocalPath], getReposPath())
        logger.info(`Cleaned up copied directory: ${repoLocalPath}`)
      } catch (fsError: unknown) {
        logger.error(`Failed to clean up copied directory ${repoLocalPath}:`, getErrorMessage(fsError))
      }
    }
    
    throw new Error(`Failed to initialize local repository '${repoLocalPath}': ${getErrorMessage(error)}`)
  }
}


export async function cloneRepo(
  database: Database,
  gitAuthService: GitAuthService,
  repoUrl: string,
  branch?: string,
  useWorktree: boolean = false,
  skipSSHVerification: boolean = false
): Promise<Repo> {
  const effectiveUrl = normalizeSSHUrl(repoUrl)
  const isSSH = isSSHUrl(effectiveUrl)
  const preserveSSH = isSSH
  const hasSSHCredential = await gitAuthService.setupSSHForRepoUrl(effectiveUrl, database, skipSSHVerification)

  const { url: normalizedRepoUrl, name: repoName } = normalizeRepoUrl(effectiveUrl, preserveSSH)
  const localPath = repoName

  const existing = db.getRepoByLocalPath(database, localPath)
  if (existing) {
    logger.info(`Repo already exists: ${normalizedRepoUrl}`)
    if (hasSSHCredential) {
      await gitAuthService.cleanupSSHKey()
    }
    return existing
  }

  await ensureDirectoryExists(getReposPath())
  const baseRepoExists = await executeCommand(['bash', '-c', `test -d ${repoName} && echo exists || echo missing`], path.resolve(getReposPath()))

  const createRepoInput: CreateRepoInput = {
    repoUrl: normalizedRepoUrl,
    localPath,
    branch: branch || undefined,
    defaultBranch: branch || 'main',
    cloneStatus: 'cloning',
    clonedAt: Date.now(),
  }

  const repo = db.createRepo(database, createRepoInput)

  try {
    const env = {
      ...gitAuthService.getGitEnvironment(),
      ...(isSSH ? gitAuthService.getSSHEnvironment() : {})
    }

    const baseRepoPath = path.resolve(getReposPath(), repoName)
    if (baseRepoExists.trim() == 'exists') {
      await executeCommand(['git', '--git-dir', baseRepoPath, 'fetch', '--all'], { env })
    } else {
      const cloneCmd = branch
        ? ['git', 'clone', '--bare', '--branch', branch, normalizedRepoUrl, repoName]
        : ['git', 'clone', '--bare', normalizedRepoUrl, repoName]

      try {
        await executeCommand(cloneCmd, { cwd: getReposPath(), env, timeout: GIT_CLONE_TIMEOUT })
      } catch (error: unknown) {
        if (branch && (getErrorMessage(error).includes('Remote branch') || getErrorMessage(error).includes('not found'))) {
          await executeCommand(['git', 'clone', '--bare', normalizedRepoUrl, repoName], { cwd: getReposPath(), env, timeout: GIT_CLONE_TIMEOUT })
        } else {
          throw enhanceCloneError(error, normalizedRepoUrl, getErrorMessage(error))
        }
      }
    }

    db.updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Repository cloned successfully: ${normalizedRepoUrl}`)

    if (hasSSHCredential) {
      await gitAuthService.cleanupSSHKey()
    }

    return { ...repo, cloneStatus: 'ready' }
  } catch (error: unknown) {
    logger.error(`Failed to clone repo: ${normalizedRepoUrl}`, error)

    try {
      db.deleteRepo(database, repo.id)
      logger.info(`Deleted repo record due to clone failure: ${repo.id}`)
    } catch (dbError: unknown) {
      logger.error(`Failed to delete repo record after clone failure: ${repo.id}`, dbError)
    }

    try {
      await executeCommand(['rm', '-rf', localPath], getReposPath())
    } catch (cleanupError: unknown) {
      logger.error(`Failed to clean up repo directory after clone failure: ${localPath}`, cleanupError)
    }

    if (hasSSHCredential) {
      await gitAuthService.cleanupSSHKey()
    }

    if (error instanceof Error && error.message.includes('Repository not found')) {
      throw new Error(`Repository not found: ${normalizedRepoUrl}. Please check that the repository exists and you have access.`)
    }

    if (error instanceof Error && error.message.includes('Authentication failed')) {
      throw new Error(`Authentication failed for ${normalizedRepoUrl}. Please check your credentials.`)
    }

    throw enhanceCloneError(error, normalizedRepoUrl, getErrorMessage(error))
  }
}

export async function getCurrentBranch(repo: Repo, env: Record<string, string>): Promise<string | null> {
  const repoPath = path.resolve(getReposPath(), repo.localPath)
  const branch = await safeGetCurrentBranch(repoPath, env)
  return branch || repo.branch || repo.defaultBranch || null
}

export async function switchBranch(
  database: Database,
  gitAuthService: GitAuthService,
  repoId: number,
  branch: string
): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(getReposPath(), repo.localPath)
    const env = gitAuthService.getGitEnvironment()

    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Switching to branch: ${sanitizedBranch} in ${repo.localPath}`)

    await executeCommand(['git', '-C', repoPath, 'fetch', '--all'], { env })
    
    await checkoutBranchSafely(repoPath, sanitizedBranch, env)
    
    logger.info(`Successfully switched to branch: ${sanitizedBranch}`)

    db.updateRepoBranch(database, repoId, sanitizedBranch)
  } catch (error: unknown) {
    logger.error(`Failed to switch branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function createBranch(database: Database, gitAuthService: GitAuthService, repoId: number, branch: string): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(getReposPath(), repo.localPath)
    const env = gitAuthService.getGitEnvironment()
    
    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Creating new branch: ${sanitizedBranch} in ${repo.localPath}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch], { env })
    logger.info(`Successfully created and switched to branch: ${sanitizedBranch}`)

    db.updateRepoBranch(database, repoId, sanitizedBranch)
  } catch (error: unknown) {
    logger.error(`Failed to create branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function pullRepo(
  database: Database,
  gitAuthService: GitAuthService,
  repoId: number
): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  if (repo.isLocal) {
    logger.info(`Skipping pull for local repo: ${repo.localPath}`)
    return
  }
  
  try {
    const env = gitAuthService.getGitEnvironment()

    logger.info(`Pulling repo: ${repo.repoUrl}`)
    await executeCommand(['git', '-C', path.resolve(getReposPath(), repo.localPath), 'pull'], { env })
    
    db.updateLastPulled(database, repoId)
    logger.info(`Repo pulled successfully: ${repo.repoUrl}`)
  } catch (error: unknown) {
    logger.error(`Failed to pull repo: ${repo.repoUrl}`, error)
    throw error
  }
}

export async function deleteRepoFiles(database: Database, repoId: number): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }

  const dirName = repo.localPath.split('/').pop() || repo.localPath
  const fullPath = path.resolve(getReposPath(), dirName)

  if (repo.isWorktree && repo.repoUrl) {
    const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
    const baseRepoPath = path.resolve(getReposPath(), repoName)

    try {
      await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', fullPath])
    } catch {
      // Worktree removal failed, continue with directory removal
    } finally {
      await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune']).catch(() => {})
    }
  }

  await executeCommand(['rm', '-rf', dirName], getReposPath())
  db.deleteRepo(database, repoId)
}

function normalizeRepoUrl(url: string, preserveSSH: boolean = false): { url: string; name: string } {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    const [, host, pathPart] = sshMatch
    const path = pathPart ?? ''
    const repoName = path.split('/').pop() || `repo-${Date.now()}`
    return {
      url: preserveSSH ? url : `https://${host}/${path.replace(/\.git$/, '')}`,
      name: repoName
    }
  }

  if (url.startsWith('ssh://')) {
    const { host } = parseSSHHost(url)
    const pathParts = url.split(`${host}/`)
    const pathPart = pathParts[1] || ''
    const repoName = pathPart.replace(/\.git$/, '').split('/').pop() || `repo-${Date.now()}`
    
    return {
      url: preserveSSH ? url : `https://${host}/${pathPart.replace(/\.git$/, '')}`,
      name: repoName
    }
  }

  const shorthandMatch = url.match(/^([^/]+)\/([^/]+)$/)
  if (shorthandMatch) {
    const [, owner, repoName] = shorthandMatch
    return {
      url: `https://github.com/${owner}/${repoName}`,
      name: repoName ?? `repo-${Date.now()}`
    }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const httpsUrl = url.replace(/^http:/, 'https:').replace(/\.git$/, '')
    const match = httpsUrl.match(/([^/]+)$/)
    return {
      url: httpsUrl,
      name: match?.[1] || `repo-${Date.now()}`
    }
  }

  return {
    url,
    name: `repo-${Date.now()}`
  }
}

async function createWorktreeSafely(baseRepoPath: string, worktreePath: string, branch: string, env: Record<string, string>): Promise<void> {
  const currentBranch = await safeGetCurrentBranch(baseRepoPath, env)
  if (currentBranch === branch) {
    const defaultBranch = await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--abbrev-ref', 'origin/HEAD'], { env })
      .then(ref => ref.trim().replace('origin/', ''))
      .catch(() => 'main')

    await executeCommand(['git', '-C', baseRepoPath, 'checkout', defaultBranch], { env })
      .catch(() => executeCommand(['git', '-C', baseRepoPath, 'checkout', 'main'], { env }))
  }

  await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'], { env }).catch(() => {})

  let branchExists = false
  try {
    await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/heads/${branch}`], { env, silent: true })
    branchExists = true
  } catch {
    try {
      await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/remotes/origin/${branch}`], { env, silent: true })
      branchExists = true
    } catch {
      branchExists = false
    }
  }

  if (branchExists) {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'add', worktreePath, branch], { env })
  } else {
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'add', '-b', branch, worktreePath], { env })
  }
}
