export type GitFileStatusType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'

export interface GitFileStatus {
  path: string
  status: GitFileStatusType
  staged: boolean
  oldPath?: string
}

export interface GitCommit {
  hash: string
  authorName: string
  authorEmail: string
  date: string
  message: string
  unpushed?: boolean
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
  diff: string
  additions: number
  deletions: number
  isBinary: boolean
}

export interface GitDiffOptions {
  showContext?: number
  ignoreWhitespace?: boolean
  unified?: number
}

export interface GitBranch {
  name: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  isWorktree?: boolean
}

export interface CommitFile {
  path: string
  status: GitFileStatusType
  oldPath?: string
  additions: number
  deletions: number
}

export interface CommitDetails extends GitCommit {
  files: CommitFile[]
}
