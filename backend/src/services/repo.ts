import { executeCommand } from '../utils/process'
import { ensureDirectoryExists } from './file-operations'
import * as db from '../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { logger } from '../utils/logger'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from './git-auth'
import path from 'path'

interface ErrorWithMessage {
  message: string
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as ErrorWithMessage).message === 'string'
  )
}

function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
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
  await executeCommand(['git', 'clone', '--local', sourcePath, targetName], { cwd: reposPath, env })
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
      if (isErrorWithMessage(error) && getErrorMessage(error).includes('No such file or directory')) {
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
      await executeCommand(['git', 'init'], { cwd: targetPath })
      
      if (branch && branch !== 'main') {
        await executeCommand(['git', '-C', targetPath, 'checkout', '-b', branch])
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
  useWorktree: boolean = false
): Promise<Repo> {
  const { url: normalizedRepoUrl, name: repoName } = normalizeRepoUrl(repoUrl)
  const baseRepoDirName = repoName
  const worktreeDirName = branch && useWorktree ? `${repoName}-${branch.replace(/[\\/]/g, '-')}` : repoName
  const localPath = worktreeDirName
  
  const existing = db.getRepoByUrlAndBranch(database, normalizedRepoUrl, branch)
  
  if (existing) {
    logger.info(`Repo branch already exists: ${normalizedRepoUrl}${branch ? `#${branch}` : ''}`)
    return existing
  }
  
  await ensureDirectoryExists(getReposPath())
  const baseRepoExists = await executeCommand(['bash', '-c', `test -d ${baseRepoDirName} && echo exists || echo missing`], path.resolve(getReposPath()))
  
  const shouldUseWorktree = useWorktree && branch && baseRepoExists.trim() === 'exists'
  
  const createRepoInput: CreateRepoInput = {
    repoUrl: normalizedRepoUrl,
    localPath,
    branch: branch || undefined,
    defaultBranch: branch || 'main',
    cloneStatus: 'cloning',
    clonedAt: Date.now(),
  }
  
  if (shouldUseWorktree) {
    createRepoInput.isWorktree = true
  }
  
  const repo = db.createRepo(database, createRepoInput)

  try {
    const env = gitAuthService.getGitEnvironment()

    if (shouldUseWorktree) {
      logger.info(`Creating worktree for branch: ${branch}`)
      
      const baseRepoPath = path.resolve(getReposPath(), baseRepoDirName)
      const worktreePath = path.resolve(getReposPath(), worktreeDirName)
      
       await executeCommand(['git', '-C', baseRepoPath, 'fetch', '--all'], { cwd: getReposPath(), env })

      
       await createWorktreeSafely(baseRepoPath, worktreePath, branch, env)
      
      const worktreeVerified = await executeCommand(['test', '-d', worktreePath])
        .then(() => true)
        .catch(() => false)
      
      if (!worktreeVerified) {
        throw new Error(`Worktree directory was not created at: ${worktreePath}`)
      }
      
      logger.info(`Worktree verified at: ${worktreePath}`)
      
    } else if (branch && baseRepoExists.trim() === 'exists' && useWorktree) {
      logger.info(`Base repo exists but worktree creation failed, cloning branch separately`)
      
      const worktreeExists = await executeCommand(['bash', '-c', `test -d ${worktreeDirName} && echo exists || echo missing`], path.resolve(getReposPath()))
      if (worktreeExists.trim() === 'exists') {
        logger.info(`Workspace directory exists, removing it: ${worktreeDirName}`)
        try {
          await executeCommand(['rm', '-rf', worktreeDirName], getReposPath())
          const verifyRemoved = await executeCommand(['bash', '-c', `test -d ${worktreeDirName} && echo exists || echo removed`], getReposPath())
          if (verifyRemoved.trim() === 'exists') {
            throw new Error(`Failed to remove existing directory: ${worktreeDirName}`)
          }
        } catch (cleanupError: unknown) {
          logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
          throw new Error(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
        }
      }
      
      try {
        await executeCommand(['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
      } catch (error: unknown) {
        if (isErrorWithMessage(error) && getErrorMessage(error).includes('destination path') && getErrorMessage(error).includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new Error(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        logger.info(`Branch '${branch}' not found during clone, cloning default branch and creating branch locally`)
        await executeCommand(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
        let localBranchExists = 'missing'
        try {
          await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
          localBranchExists = 'exists'
        } catch {
          localBranchExists = 'missing'
        }
          if (localBranchExists.trim() === 'missing') {
            await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'checkout', '-b', branch])
          } else {
            await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'checkout', branch])
          }
      }
    } else {
      if (baseRepoExists.trim() === 'exists') {
        logger.info(`Repository directory already exists, verifying it's a valid git repo: ${baseRepoDirName}`)
        const isValidRepo = await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'rev-parse', '--git-dir'], path.resolve(getReposPath())).then(() => 'valid').catch(() => 'invalid')
        
        if (isValidRepo.trim() === 'valid') {
          logger.info(`Valid repository found: ${normalizedRepoUrl}`)
          
          if (branch) {
            logger.info(`Switching to branch: ${branch}`)
             await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'fetch', '--all'], { cwd: getReposPath(), env })

            
            let remoteBranchExists = false
            try {
              await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'rev-parse', '--verify', `refs/remotes/origin/${branch}`])
              remoteBranchExists = true
            } catch {
              remoteBranchExists = false
            }
            
            let localBranchExists = false
            try {
              await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
              localBranchExists = true
            } catch {
              localBranchExists = false
            }
            
            if (localBranchExists) {
              logger.info(`Checking out existing local branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'checkout', branch])
            } else if (remoteBranchExists) {
              logger.info(`Checking out remote branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'checkout', '-b', branch, `origin/${branch}`])
            } else {
              logger.info(`Creating new branch: ${branch}`)
              await executeCommand(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'checkout', '-b', branch])
            }
          }
          
          db.updateRepoStatus(database, repo.id, 'ready')
          return { ...repo, cloneStatus: 'ready' }
        } else {
          logger.warn(`Invalid repository directory found, removing and recloning: ${baseRepoDirName}`)
          await executeCommand(['rm', '-rf', baseRepoDirName], getReposPath())
        }
      }
      
      logger.info(`Cloning repo: ${normalizedRepoUrl}${branch ? ` to branch ${branch}` : ''}`)
      
      const worktreeExists = await executeCommand(['bash', '-c', `test -d ${worktreeDirName} && echo exists || echo missing`], getReposPath())
      if (worktreeExists.trim() === 'exists') {
        logger.info(`Workspace directory exists, removing it: ${worktreeDirName}`)
        try {
          await executeCommand(['rm', '-rf', worktreeDirName], getReposPath())
          const verifyRemoved = await executeCommand(['bash', '-c', `test -d ${worktreeDirName} && echo exists || echo removed`], getReposPath())
        if (verifyRemoved.trim() === 'exists') {
          throw new Error(`Failed to remove existing directory: ${worktreeDirName}`)
        }
      } catch (cleanupError: unknown) {
        logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
        throw new Error(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
      }
    }
    
      try {
        const cloneCmd = branch
          ? ['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName]
          : ['git', 'clone', normalizedRepoUrl, worktreeDirName]
        
        await executeCommand(cloneCmd, { cwd: getReposPath(), env })
      } catch (error: unknown) {
        if (isErrorWithMessage(error) && getErrorMessage(error).includes('destination path') && getErrorMessage(error).includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new Error(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        if (branch && isErrorWithMessage(error) && (getErrorMessage(error).includes('Remote branch') || getErrorMessage(error).includes('not found'))) {
          logger.info(`Branch '${branch}' not found, cloning default branch and creating branch locally`)
          await executeCommand(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
          let localBranchExists = 'missing'
          try {
            await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'rev-parse', '--verify', `refs/heads/${branch}`])
            localBranchExists = 'exists'
          } catch {
            localBranchExists = 'missing'
          }
          
          if (localBranchExists.trim() === 'missing') {
            await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'checkout', '-b', branch])
          } else {
            await executeCommand(['git', '-C', path.resolve(getReposPath(), worktreeDirName), 'checkout', branch])
          }
        } else {
          throw error
        }
      }
    }
    
    db.updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Repo ready: ${normalizedRepoUrl}${branch ? `#${branch}` : ''}${shouldUseWorktree ? ' (worktree)' : ''}`)
    return { ...repo, cloneStatus: 'ready' }
  } catch (error: unknown) {
    logger.error(`Failed to create repo: ${normalizedRepoUrl}${branch ? `#${branch}` : ''}`, error)
    db.deleteRepo(database, repo.id)
    throw error
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

function normalizeRepoUrl(url: string): { url: string; name: string } {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    const [, host, pathPart] = sshMatch
    const repoName = pathPart.split('/').pop() || `repo-${Date.now()}`
    return {
      url: `https://${host}/${pathPart.replace(/\.git$/, '')}`,
      name: repoName
    }
  }

  const shorthandMatch = url.match(/^([^/]+)\/([^/]+)$/)
  if (shorthandMatch) {
    const [, owner, repoName] = shorthandMatch
    return {
      url: `https://github.com/${owner}/${repoName}`,
      name: repoName
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

export async function cleanupOrphanedDirectories(database: Database): Promise<void> {
  try {
    const reposPath = getReposPath()
    await ensureDirectoryExists(reposPath)

    const dirResult = await executeCommand(['ls', '-1'], reposPath).catch(() => '')
    const directories = dirResult.split('\n').filter(d => d.trim())

    if (directories.length === 0) {
      return
    }

    const allRepos = db.listRepos(database)
    const trackedPaths = new Set(allRepos.map(r => r.localPath.split('/').pop()))
    const orphanedDirs = directories.filter(dir => !trackedPaths.has(dir))

    for (const dir of orphanedDirs) {
      await executeCommand(['rm', '-rf', dir], reposPath).catch(() => {})
    }
  } catch {
    // Cleanup is best-effort
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