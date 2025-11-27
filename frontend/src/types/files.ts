export interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mimeType?: string
  content?: string
  children?: FileInfo[]
  lastModified: Date
  workspaceRoot?: string
  totalLines?: number
}

export interface ChunkedFileInfo {
  name: string
  path: string
  isDirectory: false
  size: number
  mimeType?: string
  lines: string[]
  totalLines: number
  startLine: number
  endLine: number
  hasMore: boolean
  lastModified: Date
}

export interface PatchOperation {
  type: 'replace' | 'insert' | 'delete'
  startLine: number
  endLine?: number
  content?: string
}
