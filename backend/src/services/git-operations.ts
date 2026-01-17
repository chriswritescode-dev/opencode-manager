import { executeCommand } from '../utils/process'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'
import path from 'path'

interface FileDiffResult {
  status: 'untracked' | 'modified' | 'staged'
  diff: string
  additions: number
  deletions: number
  isBinary: boolean
}

export async function getFileDiff(repoPath: string, fileName: string): Promise<FileDiffResult> {
  try {
    const filePath = path.resolve(repoPath, fileName)

    // First check if file is tracked
    const isTrackedResult = await executeCommand([
      'git',
      '-C',
      repoPath,
      'ls-files',
      '--error-unmatch',
      fileName
    ], { ignoreExitCode: true })

    const isTracked = typeof isTrackedResult === 'string' ? isTrackedResult : isTrackedResult.stdout
    const isTrackedExitCode = typeof isTrackedResult === 'string' ? 0 : isTrackedResult.exitCode

    let diff: string
    let status: 'untracked' | 'modified' | 'staged'

    if (isTrackedExitCode !== 0) {
      // File is untracked, use git diff --no-index
      try {
        const diffResult = await executeCommand([
          'git',
          '--no-index',
          'diff',
          '/dev/null',
          filePath
        ], { ignoreExitCode: true })

        if (typeof diffResult === 'string') {
          diff = diffResult
        } else {
          diff = diffResult.stdout
        }
        status = 'untracked'
      } catch (error: any) {
        // This shouldn't happen with ignoreExitCode, but just in case
        throw error
      }
    } else {
      // File is tracked, check if it's staged
      const stagedDiffResult = await executeCommand([
        'git',
        '-C',
        repoPath,
        'diff',
        '--cached',
        '--',
        fileName
      ], { ignoreExitCode: true })

      const stagedDiff = typeof stagedDiffResult === 'string' ? stagedDiffResult : stagedDiffResult.stdout

      if (stagedDiff.trim()) {
        // File has staged changes
        diff = stagedDiff
        status = 'staged'
      } else {
        // File has unstaged changes
        diff = await executeCommand([
          'git',
          '-C',
          repoPath,
          'diff',
          '--',
          fileName
        ])
        status = 'modified'
      }
    }

    // Parse diff to count additions/deletions
    const lines = diff.split('\n')
    let additions = 0
    let deletions = 0
    let isBinary = false

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      } else if (line.includes('Binary files')) {
        isBinary = true
        break
      }
    }

    return {
      status,
      diff,
      additions,
      deletions,
      isBinary
    }
  } catch (error: unknown) {
    logger.error(`Failed to get file diff for ${fileName}:`, error)
    throw new Error(`Failed to get file diff: ${getErrorMessage(error)}`)
  }
}