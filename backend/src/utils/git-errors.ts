import type { GitErrorCode } from '@opencode-manager/shared'
import { getErrorMessage } from './error-utils'

export type { GitErrorCode }

export function isNoUpstreamError(error: Error): boolean {
  const patterns = [
    /The current branch .+ has no upstream branch/i,
    /no upstream configured for branch/i,
    /no upstream branch/i,
  ]
  return patterns.some(pattern => pattern.test(error.message))
}

export function parseBranchNameFromError(error: Error): string | null {
  const match = error.message.match(/The current branch (.+) has no upstream branch/i)
  return match?.[1]?.trim() ?? null
}

export interface GitErrorInfo {
  code: GitErrorCode
  summary: string
  detail: string
  statusCode: number
}

interface ErrorPattern {
  code: GitErrorCode
  summary: string
  statusCode: number
  patterns: RegExp[]
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    code: 'AUTH_FAILED',
    summary: 'Authentication failed. Check your credentials in Settings > Git Credentials.',
    statusCode: 401,
    patterns: [
      /authentication failed/i,
      /could not read Username/i,
      /could not read password/i,
      /git credentials/i,
    ],
  },
  {
    code: 'REPO_NOT_FOUND',
    summary: 'Repository not found. Check the URL and ensure you have access.',
    statusCode: 404,
    patterns: [
      /repository not found/i,
      /fatal: .* does not exist/i,
      /could not resolve host/i,
    ],
  },
  {
    code: 'PERMISSION_DENIED',
    summary: 'Permission denied. Check your repository access and credentials.',
    statusCode: 403,
    patterns: [
      /permission denied/i,
      /access denied/i,
      /not a readable path/i,
    ],
  },
  {
    code: 'PUSH_REJECTED',
    summary: 'Push rejected. Pull the latest changes first, then try again.',
    statusCode: 409,
    patterns: [
      /non-fast-forward/i,
      /rejected push/i,
      /fetch first/i,
      /Updates were rejected/i,
      /push failed/i,
    ],
  },
  {
    code: 'MERGE_CONFLICT',
    summary: 'Merge conflict detected. Resolve the conflicts before continuing.',
    statusCode: 409,
    patterns: [
      /CONFLICT \(/,
      /merge conflict/i,
      /fix conflicts/i,
    ],
  },
  {
    code: 'NO_UPSTREAM',
    summary: 'No upstream branch configured. Push will set upstream automatically.',
    statusCode: 400,
    patterns: [
      /no upstream branch/i,
      /has no upstream branch/i,
      /no upstream configured/i,
    ],
  },
  {
    code: 'TIMEOUT',
    summary: 'Operation timed out. Check your network connection and try again.',
    statusCode: 504,
    patterns: [
      /timed out/i,
      /etimedout/i,
      /connection timed out/i,
    ],
  },
  {
    code: 'NOT_A_REPO',
    summary: 'Not a valid Git repository.',
    statusCode: 400,
    patterns: [
      /not a git repository/i,
      /fatal: not a git repository/i,
    ],
  },
  {
    code: 'LOCK_FAILED',
    summary: 'Git is locked by another process. Wait a moment and try again.',
    statusCode: 409,
    patterns: [
      /unable to create lock/i,
      /index\.lock/i,
      /another git process seems to be running/i,
    ],
  },
  {
    code: 'DETACHED_HEAD',
    summary: 'Repository is in detached HEAD state. Switch to a branch first.',
    statusCode: 400,
    patterns: [
      /HEAD detached/i,
      /detached at/i,
      /detached HEAD/i,
    ],
  },
  {
    code: 'BRANCH_EXISTS',
    summary: 'A branch with that name already exists.',
    statusCode: 409,
    patterns: [
      /branch .* already exists/i,
      /fatal: A branch named .* already exists/i,
    ],
  },
  {
    code: 'BRANCH_NOT_FOUND',
    summary: 'Branch not found. Check the branch name and try again.',
    statusCode: 404,
    patterns: [
      /pathspec .* did not match/i,
      /unknown revision/i,
      /invalid ref/i,
      /reference.*not found/i,
    ],
  },
  {
    code: 'UNCOMMITTED_CHANGES',
    summary: 'You have uncommitted changes. Commit or stash them first.',
    statusCode: 409,
    patterns: [
      /uncommitted changes/i,
      /local changes.*overwritten/i,
      /would lose uncommitted changes/i,
    ],
  },
]

function stripCommandFailedPrefix(message: string): string {
  return message.replace(/^Command failed with code \d+:\s*/, '')
}

const PROGRESS_LINE_PATTERNS = [
  /^remote: Counting objects:.*$/gm,
  /^remote: Compressing objects:.*$/gm,
  /^remote: Receiving objects:.*$/gm,
  /^remote: Total .*$/gm,
  /^Resolving deltas:.*$/gm,
  /^From .+$/gm,
  /^ \* \[new branch] {2,}.*$/gm,
  /^ {3}.+-> .+$/gm,
]

function cleanGitProgressLines(message: string): string {
  let cleaned = message
  for (const pattern of PROGRESS_LINE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

export function parseGitError(error: unknown): GitErrorInfo {
  const rawMessage = getErrorMessage(error)
  const message = stripCommandFailedPrefix(rawMessage)
  const cleanedMessage = cleanGitProgressLines(message)

  for (const errorPattern of ERROR_PATTERNS) {
    for (const pattern of errorPattern.patterns) {
      if (pattern.test(message) || pattern.test(cleanedMessage)) {
        return {
          code: errorPattern.code,
          summary: errorPattern.summary,
          detail: cleanedMessage || message,
          statusCode: errorPattern.statusCode,
        }
      }
    }
  }

  return {
    code: 'UNKNOWN',
    summary: 'A git operation failed.',
    detail: cleanedMessage || message,
    statusCode: 500,
  }
}
