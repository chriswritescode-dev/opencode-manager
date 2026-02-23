import { exec } from 'child_process'
import { readFile } from 'fs/promises'
import { fileExists } from './file-operations'

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

  const cacheFile = `${repoFullPath}/.git/opencode`
  const cacheExists = await fileExists(cacheFile)

  if (cacheExists) {
    try {
      const cachedId = (await readFile(cacheFile, 'utf-8')).trim()
      if (cachedId) {
        projectIdCache.set(repoFullPath, cachedId)
        return cachedId
      }
    } catch {
      // cache file may not exist or be readable
    }
  }

  try {
    const gitDir = `${repoFullPath}/.git`
    const gitDirExists = await fileExists(gitDir)
    if (!gitDirExists) {
      return null
    }

    const output = await executeGitCommand(repoFullPath, [
      'rev-list',
      '--max-parents=0',
      '--all',
    ])

    if (!output) {
      return null
    }

    const commits = output.split('\n').filter(Boolean).sort()
    const projectId = commits[0]

    if (!projectId) {
      return null
    }

    projectIdCache.set(repoFullPath, projectId)
    return projectId
  } catch {
    return null
  }
}
