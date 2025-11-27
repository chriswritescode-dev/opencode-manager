import { executeCommand } from '../utils/process'
import { logger } from '../utils/logger'
import path from 'path'

export type GitFileStatusType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'

export interface GitFileStatus {
  path: string
  status: GitFileStatusType
  staged: boolean
  oldPath?: string
}

export interface GitStatusResponse {
  branch: string
  ahead: number
  behind: number
  files: GitFileStatus[]
  hasChanges: boolean
}

export interface FileDiffResponse {
  path: string
  status: GitFileStatusType
  diff: string | null
  additions: number
  deletions: number
  isBinary: boolean
}

function parseStatusCode(code: string): GitFileStatusType {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case '?': return 'untracked'
    default: return 'modified'
  }
}

function parsePorcelainV2(output: string): { branch: string; ahead: number; behind: number; files: GitFileStatus[] } {
  const lines = output.split('\n').filter(line => line.trim())
  let branch = 'HEAD'
  let ahead = 0
  let behind = 0
  const files: GitFileStatus[] = []

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      branch = line.replace('# branch.head ', '')
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+(\d+) -(\d+)/)
      if (match && match[1] && match[2]) {
        ahead = parseInt(match[1], 10)
        behind = parseInt(match[2], 10)
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      if (!xy || xy.length < 2) continue
      const stagedStatus = xy[0] as string
      const unstagedStatus = xy[1] as string

      if (line.startsWith('2 ')) {
        const pathParts = parts.slice(8).join(' ').split('\t')
        const filePath = pathParts[1] || pathParts[0] || ''
        const oldPath = pathParts[0] || ''

        if (stagedStatus !== '.') {
          files.push({
            path: filePath,
            status: parseStatusCode(stagedStatus),
            staged: true,
            oldPath: stagedStatus === 'R' || stagedStatus === 'C' ? oldPath : undefined
          })
        }
        if (unstagedStatus !== '.') {
          files.push({
            path: filePath,
            status: parseStatusCode(unstagedStatus),
            staged: false
          })
        }
      } else {
        const filePath = parts.slice(8).join(' ') || ''

        if (stagedStatus !== '.') {
          files.push({
            path: filePath,
            status: parseStatusCode(stagedStatus),
            staged: true
          })
        }
        if (unstagedStatus !== '.') {
          files.push({
            path: filePath,
            status: parseStatusCode(unstagedStatus),
            staged: false
          })
        }
      }
    } else if (line.startsWith('? ')) {
      const filePath = line.substring(2)
      files.push({
        path: filePath,
        status: 'untracked',
        staged: false
      })
    }
  }

  return { branch, ahead, behind, files }
}

export async function getGitStatus(repoPath: string): Promise<GitStatusResponse> {
  try {
    const fullPath = path.resolve(repoPath)
    const output = await executeCommand(['git', '-C', fullPath, 'status', '--porcelain=v2', '--branch'])
    const { branch, ahead, behind, files } = parsePorcelainV2(output)

    return {
      branch,
      ahead,
      behind,
      files,
      hasChanges: files.length > 0
    }
  } catch (error: any) {
    logger.error(`Failed to get git status for ${repoPath}:`, error)
    throw new Error(`Failed to get git status: ${error.message}`)
  }
}

export async function getFileDiff(repoPath: string, filePath: string): Promise<FileDiffResponse> {
  try {
    const fullRepoPath = path.resolve(repoPath)
    const status = await getGitStatus(repoPath)
    const fileStatus = status.files.find(f => f.path === filePath)

    if (!fileStatus) {
      return {
        path: filePath,
        status: 'modified',
        diff: null,
        additions: 0,
        deletions: 0,
        isBinary: false
      }
    }

    let diff: string | null = null
    let additions = 0
    let deletions = 0
    let isBinary = false

    if (fileStatus.status === 'untracked') {
      try {
        const content = await executeCommand(['git', '-C', fullRepoPath, 'diff', '--no-index', '--', '/dev/null', filePath])
        diff = content
      } catch (error: any) {
        if (error.message?.includes('exit code 1') || error.message?.includes('Command failed with code 1')) {
          const output = error.message || ''
          const diffMatch = output.match(/diff --git[\s\S]*/)
          diff = diffMatch ? diffMatch[0] : `New file: ${filePath}`
        } else {
          diff = `New file: ${filePath}`
        }
      }
    } else {
      try {
        diff = await executeCommand(['git', '-C', fullRepoPath, 'diff', 'HEAD', '--', filePath])
      } catch (error: any) {
        logger.warn(`Failed to get diff for ${filePath}:`, error.message)
        diff = null
      }
    }

    if (diff) {
      if (diff.includes('Binary files') || diff.includes('GIT binary patch')) {
        isBinary = true
      } else {
        const lines = diff.split('\n')
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            additions++
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++
          }
        }
      }
    }

    return {
      path: filePath,
      status: fileStatus.status,
      diff,
      additions,
      deletions,
      isBinary
    }
  } catch (error: any) {
    logger.error(`Failed to get file diff for ${filePath}:`, error)
    throw new Error(`Failed to get file diff: ${error.message}`)
  }
}
