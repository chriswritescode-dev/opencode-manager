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
  | 'UNCOMMITTED_CHANGES'
  | 'UNKNOWN'

export type ApiErrorCode = GitErrorCode | 'INVALID_JSON' | 'TIMEOUT'

export interface ApiErrorResponse {
  error: string
  code?: string
  detail?: string
  details?: unknown
}

export class FetchError extends Error {
  statusCode?: number
  code?: string
  detail?: string

  constructor(message: string, statusCode?: number, code?: string, detail?: string) {
    super(message)
    this.name = 'FetchError'
    this.statusCode = statusCode
    this.code = code
    this.detail = detail
  }
}
