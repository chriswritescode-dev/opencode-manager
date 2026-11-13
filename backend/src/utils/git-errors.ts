import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { GitErrorCode } from '@opencode-manager/shared'
import type { JsonObject } from '@opencode-manager/shared/utils'
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

export class GitOperationError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message?: string,
    readonly details?: JsonObject
  ) {
    super(message)
    this.name = 'GitOperationError'
  }
}

export interface GitErrorInfo {
  code: GitErrorCode
  summary: string
  detail: string
  statusCode: ContentfulStatusCode
  details?: JsonObject
}

interface ErrorPattern {
  code: GitErrorCode
  summary: string
  statusCode: ContentfulStatusCode
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
    code: 'BRANCH_CHECKED_OUT',
    summary: 'This branch is currently checked out and cannot be deleted.',
    statusCode: 409,
    patterns: [
      /cannot delete branch .*checked out/i,
    ],
  },
  {
    code: 'BRANCH_IN_OTHER_WORKTREE',
    summary: 'This branch is checked out in another worktree and cannot be modified here.',
    statusCode: 409,
    patterns: [],
  },
  {
    code: 'BRANCH_NOT_MERGED',
    summary: 'This branch has unmerged commits. Merge it or delete it with force.',
    statusCode: 409,
    patterns: [
      /is not fully merged/i,
    ],
  },
  {
    code: 'REMOTE_BRANCH_MISMATCH',
    summary: "The branch's upstream has a different name, so its remote branch was not deleted.",
    statusCode: 409,
    patterns: [],
  },
  {
    code: 'STASH_CHANGED',
    summary: 'The stash list changed. Refresh and try again.',
    statusCode: 409,
    patterns: [],
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
  {
    code: 'NO_OPERATION_IN_PROGRESS',
    summary: 'No merge, rebase, cherry-pick, or revert is in progress.',
    statusCode: 409,
    patterns: [],
  },
  {
    code: 'INTEGRATE_DETACHED_HEAD',
    summary: 'Cannot integrate from a detached HEAD',
    statusCode: 400,
    patterns: [],
  },
  {
    code: 'INTEGRATE_INTO_SELF',
    summary: 'Cannot integrate a branch into itself',
    statusCode: 400,
    patterns: [],
  },
  {
    code: 'INTEGRATE_TARGET_NOT_CHECKED_OUT',
    summary: 'Target branch is not checked out in any worktree',
    statusCode: 409,
    patterns: [],
  },
  {
    code: 'INTEGRATE_TARGET_NOT_MANAGED',
    summary: 'Target checkout is not a managed repository',
    statusCode: 409,
    patterns: [],
  },
  {
    code: 'INTEGRATE_NOTHING_TO_INTEGRATE',
    summary: 'Nothing to integrate',
    statusCode: 400,
    patterns: [],
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

export function parseGitError(cause: unknown): GitErrorInfo {
  const rawMessage = getErrorMessage(cause)
  const message = stripCommandFailedPrefix(rawMessage)
  const cleanedMessage = cleanGitProgressLines(message)

  if (cause instanceof GitOperationError) {
    const entry = ERROR_PATTERNS.find((errorPattern) => errorPattern.code === cause.code)
    const info: GitErrorInfo = {
      code: cause.code,
      summary: entry?.summary ?? 'A git operation failed.',
      detail: cleanedMessage || message,
      statusCode: entry?.statusCode ?? 500,
    }
    if (cause.details) {
      info.details = cause.details
    }
    return info
  }

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
