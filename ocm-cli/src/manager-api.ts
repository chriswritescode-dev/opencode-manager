export interface MirrorBeginOpts {
  force?: boolean
  create?: { name: string; originUrl: string | null; branch: string | null }
}

export interface MirrorBeginResult {
  uploadId: string
  repoId: number
  chunkSize: number
  created: boolean
}

export interface MirrorCommitResult {
  repoId: number
  fullPath: string
  branch: string | null
  head: string | null
  created: boolean
}

export class ManagerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly operation: string,
  ) {
    super(message)
    this.name = 'ManagerApiError'
  }
}

async function formatErrorResponse(res: Response, operation: string): Promise<ManagerApiError> {
  const text = await res.text().catch(() => '')
  let code: string | null = null
  let detail = text
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
      const errField = typeof parsed.error === 'string' ? parsed.error : null
      const msgField = typeof parsed.message === 'string' ? parsed.message : null
      code = errField
      detail = msgField ?? errField ?? text
    } catch {
      /* not JSON, keep raw text */
    }
  }
  const message = detail
    ? `${operation} failed (${res.status}): ${detail}`
    : `${operation} failed (${res.status})`
  return new ManagerApiError(message, res.status, code, operation)
}

export class ManagerApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  async mirrorBegin(repoId: number, opts: MirrorBeginOpts): Promise<MirrorBeginResult> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/begin`
    const body: Record<string, unknown> = { force: opts.force === true }
    if (opts.create) {
      body.create = true
      body.name = opts.create.name
      if (opts.create.originUrl) body.originUrl = opts.create.originUrl
      if (opts.create.branch) body.branch = opts.create.branch
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await formatErrorResponse(res, 'mirror begin')
    return (await res.json()) as MirrorBeginResult
  }

  async mirrorUploadPart(repoId: number, uploadId: string, index: number, chunk: Buffer): Promise<void> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/parts/${uploadId}/${index}`
    const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/octet-stream' },
      body: ab as ArrayBuffer,
    })
    if (!res.ok) throw await formatErrorResponse(res, `mirror part ${index}`)
  }

  async mirrorCommit(repoId: number, uploadId: string, totalParts: number, gzip: boolean): Promise<MirrorCommitResult> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/commit`
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, totalParts, gzip }),
    })
    if (!res.ok) throw await formatErrorResponse(res, 'mirror commit')
    return (await res.json()) as MirrorCommitResult
  }

  async mirrorAbort(repoId: number, uploadId: string): Promise<void> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/uploads/${uploadId}`
    await fetch(url, { method: 'DELETE', headers: this.headers() }).catch(() => { /* best-effort */ })
  }

  async mirrorDown(repoId: number, gzip: boolean): Promise<ReadableStream<Uint8Array>> {
    const query = gzip ? '?compress=gzip' : ''
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror${query}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror download')
    return res.body!
  }
}
