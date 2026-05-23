export interface GitInfo {
  repoId: number
  repoName: string | null
  directory: string
  originUrl: string | null
  head: string | null
  branch: string | null
  dirty: boolean
}

export interface DiffEntry {
  path: string
  status: 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'typechange' | 'unmerged'
  mode?: string
  size?: number
  symlinkTarget?: string
  oldPath?: string
}

export interface WorkingTreeDiff {
  repoId: number
  head: string | null
  files: DiffEntry[]
}

export type PushFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed'

export interface PushManifestEntry {
  path: string
  status: PushFileStatus
  mode?: string
  size?: number
  symlinkTarget?: string
  oldPath?: string
}

export interface BeginPushRequest {
  expectedHead: string | null
  force?: boolean
  manifest: PushManifestEntry[]
}

export interface BeginPushResponse {
  token: string
  repoId: number
  remoteHead: string | null
  expiresAt: number
  filesNeeded: string[]
}

export class ManagerApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  async getGitInfo(repoId: number): Promise<GitInfo> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/git-info`, { headers: this.headers() })
    if (!res.ok) throw new Error(`git-info ${res.status}: ${await res.text()}`)
    return (await res.json()) as GitInfo
  }

  async getWorkingTreeDiff(repoId: number): Promise<WorkingTreeDiff> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/working-tree-diff`, { headers: this.headers() })
    if (!res.ok) throw new Error(`working-tree-diff ${res.status}: ${await res.text()}`)
    return (await res.json()) as WorkingTreeDiff
  }

  async getWorkingTreeFile(repoId: number, relPath: string): Promise<ReadableStream<Uint8Array>> {
    const url = new URL(`${this.baseUrl}/api/internal/repos/${repoId}/working-tree-file`)
    url.searchParams.set('path', relPath)
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) throw new Error(`working-tree-file ${res.status} for ${relPath}: ${await res.text()}`)
    if (!res.body) throw new Error(`working-tree-file empty body for ${relPath}`)
    return res.body
  }

  async beginPush(repoId: number, body: BeginPushRequest): Promise<BeginPushResponse> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/push/begin`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { parsed = null }
      const err = new Error(`push/begin ${res.status}: ${text}`) as Error & { status: number; detail: unknown }
      err.status = res.status
      err.detail = parsed
      throw err
    }
    return JSON.parse(text) as BeginPushResponse
  }

  async pushFile(token: string, relPath: string, body: BodyInit, byteLength?: number): Promise<void> {
    const url = new URL(`${this.baseUrl}/api/internal/repos/push/${token}/file`)
    url.searchParams.set('path', relPath)
    const extra: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
    if (byteLength !== undefined) extra['Content-Length'] = String(byteLength)
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers(extra),
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    if (!res.ok) throw new Error(`push/file ${res.status} for ${relPath}: ${await res.text()}`)
  }

  async commitPush(token: string): Promise<{ ok: boolean; applied: number }> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/push/${token}/commit`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`push/commit ${res.status}: ${await res.text()}`)
    return (await res.json()) as { ok: boolean; applied: number }
  }

  async cancelPush(token: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/internal/repos/push/${token}/cancel`, {
      method: 'POST',
      headers: this.headers(),
    }).catch(() => {})
  }
}
