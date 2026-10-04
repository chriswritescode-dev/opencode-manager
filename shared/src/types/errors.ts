export type GitErrorCode =
  | 'AUTH_FAILED'
  | 'REPO_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'PUSH_REJECTED'
  | 'MERGE_CONFLICT'
  | 'NO_UPSTREAM'
  | 'TIMEOUT'
  | 'NOT_A_REPO'
  | 'LOCK_FAILED'
  | 'DETACHED_HEAD'
  | 'BRANCH_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_CHECKED_OUT'
  | 'BRANCH_IN_OTHER_WORKTREE'
  | 'BRANCH_NOT_MERGED'
  | 'STASH_CHANGED'
  | 'UNCOMMITTED_CHANGES'
  | 'NO_OPERATION_IN_PROGRESS'
  | 'INTEGRATE_DETACHED_HEAD'
  | 'INTEGRATE_INTO_SELF'
  | 'INTEGRATE_TARGET_NOT_CHECKED_OUT'
  | 'INTEGRATE_TARGET_NOT_MANAGED'
  | 'INTEGRATE_NOTHING_TO_INTEGRATE'
  | 'UNKNOWN'

export type ApiErrorCode = GitErrorCode | 'INVALID_JSON' | 'TIMEOUT'

export interface ApiErrorResponse {
  error: string
  code?: string
  detail?: string
  details?: unknown
  validationIssues?: Array<{ path: string; message: string }>
}

export class FetchError extends Error {
  statusCode?: number
  code?: string
  detail?: string
  details?: unknown
  validationIssues?: Array<{ path: string; message: string }>

  constructor(
    message: string,
    statusCode?: number,
    code?: string,
    detail?: string,
    options?: {
      details?: unknown
      validationIssues?: Array<{ path: string; message: string }>
    }
  ) {
    super(message)
    this.name = 'FetchError'
    this.statusCode = statusCode
    this.code = code
    this.detail = detail
    this.details = options?.details
    this.validationIssues = options?.validationIssues
  }
}
