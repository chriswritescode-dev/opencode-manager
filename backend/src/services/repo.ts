import { executeCommand } from '../utils/process'
import { ensureDirectoryExists } from './file-operations'
import * as db from '../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../types/repo'
import { logger } from '../utils/logger'
import { SettingsService } from './settings'
import { createGitEnvForRepoUrl, createNoPromptGitEnv, createGitHubGitEnv } from '../utils/git-auth'
import { getReposPath } from '@opencode-manager/shared/config/env'
import path from 'path'

export class GitAuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitAuthenticationError'
  }
}

function isAuthenticationError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  return message.includes('authentication failed') || 
         message.includes('invalid username or token') ||
         message.includes('could not read username')
}

interface GitCommandOptions {
  cwd?: string
  env?: Record<string, string>
  silent?: boolean
}

async function executeGitWithFallback(
  cmd: string[],
  options: GitCommandOptions = {}
): Promise<string> {
  const { cwd, env = createNoPromptGitEnv(), silent } = options
  
  try {
    return await executeCommand(cmd, { cwd, env, silent })
  } catch (error: any) {
    if (!isAuthenticationError(error)) {
      throw error
    }
    
    logger.warn(`Git command failed with auth, trying gh auth fallback`)
    try {
      const ghToken = (await executeCommand(['gh', 'auth', 'token'])).trim()
      const ghEnv = createGitHubGitEnv(ghToken)
      return await executeCommand(cmd, { cwd, env: ghEnv, silent })
    } catch (ghError: any) {
      if (!isAuthenticationError(ghError)) {
        throw ghError
      }
      
      logger.warn(`Git command failed with gh auth, trying without auth (public repo)`)
      return await executeCommand(cmd, { cwd, env: createNoPromptGitEnv(), silent })
    }
  }
}

async function hasCommits(repoPath: string): Promise<boolean> {
  try {
    await executeCommand(['git', '-C', repoPath, 'rev-parse', 'HEAD'], { silent: true })
    return true
  } catch {
    return false
  }
}



async function safeGetCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const repoHasCommits = await hasCommits(repoPath)
    if (!repoHasCommits) {
      try {
        const symbolicRef = await executeCommand(['git', '-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { silent: true })
        return symbolicRef.trim()
      } catch {
        return null
      }
    }
    const currentBranch = await executeCommand(['git', '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { silent: true })
    return currentBranch.trim()
  } catch {
    return null
  }
}

function getGitEnv(database: Database, repoUrl?: string | null): Record<string, string> {
  try {
    const settingsService = new SettingsService(database)
    const settings = settingsService.getSettings('default')
    const gitToken = settings.preferences.gitToken

    if (!repoUrl) {
      return createNoPromptGitEnv()
    }

    return createGitEnvForRepoUrl(repoUrl, gitToken)
  } catch {
    return createNoPromptGitEnv()
  }
}

export async function initLocalRepo(
  database: Database,
  localPath: string,
  branch?: string
): Promise<Repo> {
  const normalizedPath = localPath.trim().replace(/\/+$/, '')
  const fullPath = path.resolve(getReposPath(), normalizedPath)
  
  const existing = db.getRepoByLocalPath(database, normalizedPath)
  if (existing) {
    logger.info(`Local repo already exists in database: ${normalizedPath}`)
    return existing
  }
  
  const createRepoInput: CreateRepoInput = {
    localPath: normalizedPath,
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
    logger.info(`Created database record for local repo: ${normalizedPath} (id: ${repo.id})`)
  } catch (error: any) {
    logger.error(`Failed to create database record for local repo: ${normalizedPath}`, error)
    throw new Error(`Failed to register local repository '${normalizedPath}': ${error.message}`)
  }
  
  try {
    await ensureDirectoryExists(fullPath)
    directoryCreated = true
    logger.info(`Created directory for local repo: ${fullPath}`)
    
    logger.info(`Initializing git repository: ${fullPath}`)

    await executeCommand(['git', 'init'], { cwd: fullPath })
    
    await executeCommand(['git', '-C', fullPath, 'commit', '--allow-empty', '-m', 'Initial commit'])
    
    if (branch && branch !== 'main') {
      await executeCommand(['git', '-C', fullPath, 'checkout', '-b', branch])
    }
    
    const isGitRepo = await executeCommand(['git', '-C', fullPath, 'rev-parse', '--git-dir'])
      .then(() => true)
      .catch(() => false)
    
    if (!isGitRepo) {
      throw new Error(`Git initialization failed - directory exists but is not a valid git repository`)
    }
    
    db.updateRepoStatus(database, repo.id, 'ready')
    logger.info(`Local git repo ready: ${normalizedPath}`)
    return { ...repo, cloneStatus: 'ready' }
  } catch (error: any) {
    logger.error(`Failed to initialize local repo, rolling back: ${normalizedPath}`, error)
    
    try {
      db.deleteRepo(database, repo.id)
      logger.info(`Rolled back database record for repo id: ${repo.id}`)
    } catch (dbError: any) {
      logger.error(`Failed to rollback database record for repo id ${repo.id}:`, dbError)
    }
    
    if (directoryCreated) {
      try {
        await executeCommand(['rm', '-rf', normalizedPath], getReposPath())
        logger.info(`Rolled back directory: ${normalizedPath}`)
      } catch (fsError: any) {
        logger.error(`Failed to rollback directory ${normalizedPath}:`, fsError)
      }
    }
    
    throw new Error(`Failed to initialize local repository '${normalizedPath}': ${error.message}`)
  }
}

export async function cloneRepo(
  database: Database,
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
    const env = getGitEnv(database, normalizedRepoUrl)

    if (shouldUseWorktree) {
      logger.info(`Creating worktree for branch: ${branch}`)
      
      const baseRepoPath = path.resolve(getReposPath(), baseRepoDirName)
      const worktreePath = path.resolve(getReposPath(), worktreeDirName)
      
       await executeGitWithFallback(['git', '-C', baseRepoPath, 'fetch', '--all'], { cwd: getReposPath(), env })

      
      await createWorktreeSafely(baseRepoPath, worktreePath, branch)
      
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
        } catch (cleanupError: any) {
          logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
          throw new Error(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
        }
      }
      
      try {
        await executeGitWithFallback(['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
      } catch (error: any) {
        if (error.message.includes('destination path') && error.message.includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new Error(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        logger.info(`Branch '${branch}' not found during clone, cloning default branch and creating branch locally`)
        await executeGitWithFallback(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
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
             await executeGitWithFallback(['git', '-C', path.resolve(getReposPath(), baseRepoDirName), 'fetch', '--all'], { cwd: getReposPath(), env })

            
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
        } catch (cleanupError: any) {
          logger.error(`Failed to clean up existing directory: ${worktreeDirName}`, cleanupError)
          throw new Error(`Cannot clone: directory ${worktreeDirName} exists and could not be removed`)
        }
      }
      
      try {
        const cloneCmd = branch
          ? ['git', 'clone', '-b', branch, normalizedRepoUrl, worktreeDirName]
          : ['git', 'clone', normalizedRepoUrl, worktreeDirName]
        
        await executeGitWithFallback(cloneCmd, { cwd: getReposPath(), env })
      } catch (error: any) {
        if (error.message.includes('destination path') && error.message.includes('already exists')) {
          logger.error(`Clone failed: directory still exists after cleanup attempt`)
          throw new Error(`Workspace directory ${worktreeDirName} already exists. Please delete it manually or contact support.`)
        }
        
        if (branch && (error.message.includes('Remote branch') || error.message.includes('not found'))) {
          logger.info(`Branch '${branch}' not found, cloning default branch and creating branch locally`)
          await executeGitWithFallback(['git', 'clone', normalizedRepoUrl, worktreeDirName], { cwd: getReposPath(), env })
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
  } catch (error: any) {
    logger.error(`Failed to create repo: ${normalizedRepoUrl}${branch ? `#${branch}` : ''}`, error)
    db.deleteRepo(database, repo.id)
    throw error
  }
}

export async function getCurrentBranch(repo: Repo): Promise<string | null> {
  const repoPath = path.resolve(getReposPath(), repo.localPath)
  const branch = await safeGetCurrentBranch(repoPath)
  return branch || repo.branch || repo.defaultBranch || null
}

export async function listBranches(database: Database, repo: Repo): Promise<{ local: string[], all: string[], current: string | null }> {
  try {
    const repoPath = path.resolve(getReposPath(), repo.localPath)
    const env = getGitEnv(database, repo.repoUrl)

    if (!repo.isLocal) {
      try {
        await executeGitWithFallback(['git', '-C', repoPath, 'fetch', '--all'], { env })
      } catch (error) {
        logger.warn(`Failed to fetch remote for repo ${repo.id}, using cached branch info:`, error)
      }
    }
    
    const localBranchesOutput = await executeCommand(['git', '-C', repoPath, 'branch', '--format=%(refname:short)'])
    const localBranches = localBranchesOutput.trim().split('\n').filter(b => b.trim())
    
    let remoteBranches: string[] = []
    try {
      const remoteBranchesOutput = await executeCommand(['git', '-C', repoPath, 'branch', '-r', '--format=%(refname:short)'])
      remoteBranches = remoteBranchesOutput.trim().split('\n')
        .filter(b => b.trim() && !b.includes('HEAD') && b.includes('/'))
    } catch (error) {
      logger.warn(`Failed to get remote branches for repo ${repo.id}:`, error)
    }
    
    const current = await getCurrentBranch(repo)
    
    const remoteOnlyBranches = remoteBranches
      .map(b => b.replace(/^[^/]+\//, ''))
      .filter(b => !localBranches.includes(b))
    
    const allBranches = [...localBranches, ...remoteOnlyBranches]
    
    return {
      local: localBranches,
      all: allBranches,
      current
    }
  } catch (error: any) {
    logger.error(`Failed to list branches for repo ${repo.id}:`, error)
    throw error
  }
}

export async function switchBranch(database: Database, repoId: number, branch: string): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(getReposPath(), repo.localPath)
    const env = getGitEnv(database, repo.repoUrl)

    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Switching to branch: ${sanitizedBranch} in ${repo.localPath}`)

    await executeGitWithFallback(['git', '-C', repoPath, 'fetch', '--all'], { env })
    
    let localBranchExists = false
    try {
      await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/heads/${sanitizedBranch}`])
      localBranchExists = true
    } catch {
      localBranchExists = false
    }
    
    let remoteBranchExists = false
    try {
      await executeCommand(['git', '-C', repoPath, 'rev-parse', '--verify', `refs/remotes/origin/${sanitizedBranch}`])
      remoteBranchExists = true
    } catch {
      remoteBranchExists = false
    }
    
    if (localBranchExists) {
      logger.info(`Checking out existing local branch: ${sanitizedBranch}`)
      await executeCommand(['git', '-C', repoPath, 'checkout', sanitizedBranch])
    } else if (remoteBranchExists) {
      logger.info(`Checking out remote branch: ${sanitizedBranch}`)
      await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch, `origin/${sanitizedBranch}`])
    } else {
      logger.info(`Creating new branch: ${sanitizedBranch}`)
      await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch])
    }
    
    logger.info(`Successfully switched to branch: ${sanitizedBranch}`)
  } catch (error: any) {
    logger.error(`Failed to switch branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function createBranch(database: Database, repoId: number, branch: string): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  try {
    const repoPath = path.resolve(getReposPath(), repo.localPath)
    
    const sanitizedBranch = branch
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^origin\//, '')

    logger.info(`Creating new branch: ${sanitizedBranch} in ${repo.localPath}`)
    await executeCommand(['git', '-C', repoPath, 'checkout', '-b', sanitizedBranch])
    logger.info(`Successfully created and switched to branch: ${sanitizedBranch}`)
  } catch (error: any) {
    logger.error(`Failed to create branch for repo ${repoId}:`, error)
    throw error
  }
}

export async function pullRepo(database: Database, repoId: number): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  if (repo.isLocal) {
    logger.info(`Skipping pull for local repo: ${repo.localPath}`)
    return
  }
  
  try {
    const env = getGitEnv(database, repo.repoUrl)

    logger.info(`Pulling repo: ${repo.repoUrl}`)
    await executeCommand(['git', '-C', path.resolve(getReposPath(), repo.localPath), 'pull'], { env })
    
    db.updateLastPulled(database, repoId)
    logger.info(`Repo pulled successfully: ${repo.repoUrl}`)
  } catch (error: any) {
    logger.error(`Failed to pull repo: ${repo.repoUrl}`, error)
    throw error
  }
}

export async function deleteRepoFiles(database: Database, repoId: number): Promise<void> {
  const repo = db.getRepoById(database, repoId)
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`)
  }
  
  const repoIdentifier = repo.repoUrl || repo.localPath
  
  try {
    logger.info(`Deleting repo files: ${repoIdentifier}`)
    
    // Extract just the directory name from the localPath
    const dirName = repo.localPath.split('/').pop() || repo.localPath
    const fullPath = path.resolve(getReposPath(), dirName)
    
    // If this is a worktree, properly remove it from git first
    if (repo.isWorktree && repo.branch && repo.repoUrl) {
      const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
      const baseRepoPath = path.resolve(getReposPath(), repoName)
      
      logger.info(`Removing worktree: ${dirName} from base repo: ${baseRepoPath}`)
      
      try {
        // First try to remove the worktree properly
        await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', fullPath])
        logger.info(`Successfully removed worktree: ${dirName}`)
      } catch (worktreeError: any) {
        logger.warn(`Failed to remove worktree with normal command, trying force: ${worktreeError.message}`)
        
        try {
          // Try force removal
          await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', fullPath])
          logger.info(`Successfully force-removed worktree: ${dirName}`)
        } catch (forceError: any) {
          logger.warn(`Force worktree removal failed, trying prune: ${forceError.message}`)
          
          try {
            // Prune worktree references and try again
            await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'])
            await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', fullPath])
            logger.info(`Successfully removed worktree after prune: ${dirName}`)
          } catch (pruneError: any) {
            logger.error(`All worktree removal methods failed: ${pruneError.message}`)
            // Continue with directory removal anyway
          }
        }
      }
    }
    
    // Remove the directory
    logger.info(`Removing directory: ${dirName} from ${getReposPath()}`)
    await executeCommand(['rm', '-rf', dirName], getReposPath())
    
    const checkExists = await executeCommand(['bash', '-c', `test -d ${dirName} && echo exists || echo deleted`], getReposPath())
    if (checkExists.trim() === 'exists') {
      logger.error(`Directory still exists after deletion: ${dirName}`)
      throw new Error(`Failed to delete workspace directory: ${dirName}`)
    }
    
    // If this was a worktree, also prune the base repo to clean up any remaining references
    if (repo.isWorktree && repo.branch && repo.repoUrl) {
      const { name: repoName } = normalizeRepoUrl(repo.repoUrl)
      const baseRepoPath = path.resolve(getReposPath(), repoName)
      
      try {
        logger.info(`Pruning worktree references in base repo: ${baseRepoPath}`)
        await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'])
      } catch (pruneError: any) {
        logger.warn(`Failed to prune worktree references: ${pruneError.message}`)
      }
    }
    
    db.deleteRepo(database, repoId)
    logger.info(`Repo deleted successfully: ${repoIdentifier}`)
  } catch (error: any) {
    logger.error(`Failed to delete repo: ${repoIdentifier}`, error)
    throw error
  }
}

function normalizeRepoUrl(url: string): { url: string; name: string } {
  const shorthandMatch = url.match(/^([^\/]+)\/([^\/]+)$/)
  if (shorthandMatch) {
    const [, owner, repoName] = shorthandMatch as [string, string, string]
    return {
      url: `https://github.com/${owner}/${repoName}`,
      name: repoName
    }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const httpsUrl = url.replace(/^http:/, 'https:')
    const urlWithoutGit = httpsUrl.replace(/\.git$/, '')
    const match = urlWithoutGit.match(/\/([^\/]+)$/)
    return {
      url: urlWithoutGit,
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
    
    if (orphanedDirs.length > 0) {
      logger.info(`Found ${orphanedDirs.length} orphaned directories: ${orphanedDirs.join(', ')}`)
      
      for (const dir of orphanedDirs) {
        try {
          logger.info(`Removing orphaned directory: ${dir}`)
          await executeCommand(['rm', '-rf', dir], reposPath)
        } catch (error) {
          logger.warn(`Failed to remove orphaned directory ${dir}:`, error)
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to cleanup orphaned directories:', error)
  }
}

async function checkWorktreeExists(baseRepoPath: string, worktreePath: string): Promise<boolean> {
  try {
    const worktreeList = await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'list', '--porcelain'])
    return worktreeList.includes(worktreePath)
  } catch {
    return false
  }
}

async function removeStaleWorktree(baseRepoPath: string, worktreePath: string): Promise<boolean> {
  try {
    logger.info(`Attempting to remove stale worktree: ${worktreePath}`)
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', worktreePath])
    logger.info(`Successfully removed stale worktree: ${worktreePath}`)
    return true
  } catch (error: any) {
    logger.warn(`Failed to remove stale worktree ${worktreePath}:`, error.message)
    return false
  }
}

async function pruneWorktreeReferences(baseRepoPath: string): Promise<void> {
  try {
    logger.info(`Pruning worktree references for: ${baseRepoPath}`)
    await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'prune'])
    logger.info(`Successfully pruned worktree references`)
  } catch (error: any) {
    logger.warn(`Failed to prune worktree references:`, error.message)
  }
}

async function cleanupStaleWorktree(baseRepoPath: string, worktreePath: string): Promise<boolean> {
  try {
    logger.info(`Cleaning up stale worktree: ${worktreePath}`)
    
    const worktreeList = await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'list', '--porcelain'])
    const lines = worktreeList.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      if (line.includes(worktreePath)) {
        logger.info(`Found worktree reference: ${line}`)
        await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'remove', '--force', worktreePath])
        logger.info(`Successfully removed worktree: ${worktreePath}`)
        return true
      }
    }
    
    logger.info(`No worktree reference found for ${worktreePath}, attempting prune`)
    await pruneWorktreeReferences(baseRepoPath)
    return true
  } catch (error: any) {
    logger.warn(`Failed to cleanup worktree ${worktreePath}:`, error.message)
    return false
  }
}

async function isBranchCheckedOutInMainWorktree(baseRepoPath: string, branch: string): Promise<boolean> {
  const currentBranch = await safeGetCurrentBranch(baseRepoPath)
  return currentBranch === branch
}

async function getAvailableBranchForWorktree(baseRepoPath: string, targetBranch: string): Promise<string> {
  const currentBranch = await safeGetCurrentBranch(baseRepoPath)
  
  if (!currentBranch) {
    return targetBranch
  }
  
  if (currentBranch === targetBranch) {
    logger.info(`Branch '${targetBranch}' is currently checked out in main worktree`)
    
    const defaultBranch = await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--abbrev-ref', 'origin/HEAD']).then(ref => ref.trim()).catch(() => 'main')
    const cleanDefaultBranch = defaultBranch.replace('origin/', '')
    
    if (cleanDefaultBranch !== currentBranch) {
      logger.info(`Switching to '${cleanDefaultBranch}' to free up '${targetBranch}' for worktree`)
      await executeCommand(['git', '-C', baseRepoPath, 'checkout', cleanDefaultBranch])
      return targetBranch
    } else {
      logger.warn(`Cannot free up branch '${targetBranch}' - it's the default branch`)
      return `${targetBranch}-worktree-${Date.now()}`
    }
  }
  
  return targetBranch
}

async function createWorktreeSafely(baseRepoPath: string, worktreePath: string, branch: string): Promise<void> {
  const currentBranch = await safeGetCurrentBranch(baseRepoPath)
  if (currentBranch === branch) {
    logger.info(`Branch '${branch}' is checked out in main repo, switching away...`)
    const defaultBranch = await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--abbrev-ref', 'origin/HEAD'])
      .then(ref => ref.trim().replace('origin/', ''))
      .catch(() => 'main')
    
    try {
      await executeCommand(['git', '-C', baseRepoPath, 'checkout', defaultBranch])
    } catch {
      logger.warn(`Could not switch to ${defaultBranch}, trying 'main'`)
      await executeCommand(['git', '-C', baseRepoPath, 'checkout', 'main'])
    }
  }
  
  let branchExists = false
  try {
    await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/heads/${branch}`])
    branchExists = true
  } catch {
    try {
      await executeCommand(['git', '-C', baseRepoPath, 'rev-parse', '--verify', `refs/remotes/origin/${branch}`])
      branchExists = true
    } catch {
      branchExists = false
    }
  }
  
  const maxRetries = 3
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Creating worktree (attempt ${attempt}/${maxRetries}): ${branch} -> ${worktreePath}`)
      
      if (branchExists) {
        await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'add', worktreePath, branch])
      } else {
        logger.info(`Branch '${branch}' does not exist, creating it in worktree`)
        await executeCommand(['git', '-C', baseRepoPath, 'worktree', 'add', '-b', branch, worktreePath])
      }
      
      logger.info(`Successfully created worktree: ${worktreePath}`)
      return
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries
      const errorMessage = error.message || ''
      
      if (errorMessage.includes('already used by worktree')) {
        logger.warn(`Worktree already exists, attempting cleanup (attempt ${attempt}/${maxRetries})`)
        
        const cleaned = await cleanupStaleWorktree(baseRepoPath, worktreePath)
        if (!cleaned && isLastAttempt) {
          throw new Error(`Failed to create worktree: '${branch}' is already used by a worktree and cleanup failed. Manual intervention may be required.`)
        }
        
        if (!cleaned) {
          logger.warn(`Cleanup failed, will retry...`)
          continue
        }
      } else if (isLastAttempt) {
        throw new Error(`Failed to create worktree after ${maxRetries} attempts: ${errorMessage}`)
      } else {
        logger.warn(`Worktree creation failed (attempt ${attempt}/${maxRetries}): ${errorMessage}, retrying...`)
      }
    }
  }
}