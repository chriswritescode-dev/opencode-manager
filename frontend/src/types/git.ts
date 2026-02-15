export type GitFileStatusType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'

export interface GitFileStatus {
  path: string
  status: GitFileStatusType
  staged: boolean
  oldPath?: string
  additions?: number
  deletions?: number
}

export interface GitCommit {
  hash: string
  authorName: string
  authorEmail: string
  date: string
  message: string
  unpushed?: boolean
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
