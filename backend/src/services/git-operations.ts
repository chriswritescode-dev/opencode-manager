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

    const isTracked = typeof isTrackedResult === 'string' ? { exitCode: 0, stdout: isTrackedResult, stderr: '' } : isTrackedResult
    const isTrackedExitCode = isTracked.exitCode

    let diff: string
    let status: 'untracked' | 'modified' | 'staged'

    if (isTrackedExitCode !== 0) {
      const diffResult = await executeCommand([
        'git',
        '--no-index',
        'diff',
        '/dev/null',
        filePath
      ], { ignoreExitCode: true })

      const diffData = typeof diffResult === 'string' ? { exitCode: 0, stdout: diffResult, stderr: '' } : diffResult
      diff = diffData.stdout
      status = 'untracked'
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

      const stagedDiffData = typeof stagedDiffResult === 'string' ? { exitCode: 0, stdout: stagedDiffResult, stderr: '' } : stagedDiffResult
      const stagedDiff = stagedDiffData.stdout

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