import { exec } from 'child_process'
import path from 'path'
import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'

const projectIdCache = new Map<string, string>()

async function executeGitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    exec('git ' + args.join(' '), { cwd }, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

export async function resolveProjectId(repoFullPath: string): Promise<string | null> {
  if (projectIdCache.has(repoFullPath)) {
    return projectIdCache.get(repoFullPath) ?? null
  }

  const projectId = await resolveOpenCodeProjectId(repoFullPath)
  if (projectId) {
    projectIdCache.set(repoFullPath, projectId)
  }
  return projectId
}

const mainCheckoutCache = new Map<string, boolean>()

export async function isGitMainCheckout(repoFullPath: string): Promise<boolean> {
  if (mainCheckoutCache.has(repoFullPath)) {
    return mainCheckoutCache.get(repoFullPath) ?? false
  }
  try {
    const gitDir = await executeGitCommand(repoFullPath, ['rev-parse', '--absolute-git-dir'])
    const commonDir = await executeGitCommand(repoFullPath, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    const isMain = !!gitDir && !!commonDir && path.resolve(gitDir) === path.resolve(commonDir)
    mainCheckoutCache.set(repoFullPath, isMain)
    return isMain
  } catch {
    mainCheckoutCache.set(repoFullPath, false)
    return false
  }
}
