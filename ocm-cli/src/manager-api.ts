import { createReadStream } from 'fs'
import { Readable } from 'stream'
import {
  MirrorCheckoutsResponseSchema,
  MirrorWorktreeCreateResponseSchema,
  MultiRunSchema,
  SessionGoalSchema,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MirrorCheckoutsResponse,
  type MirrorWorktreeCreateResponse,
  type MultiRun,
  type SessionGoal,
  type StartSessionGoalRequest,
} from '@opencode-manager/shared/schemas'

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

export interface MirrorPatchResult {
  repoId: number
  fullPath: string
  branch: string | null
  head: string | null
  created: false
  applied: true
}

export interface MirrorPatchSnapshot {
  repoId: number
  branch: string | null
  head: string | null
  patch: string
}

export interface MirrorHead {
  repoId: number
  branch: string | null
  head: string | null
  dirty: boolean
}

export interface MirrorBundleResult {
  repoId: number
  fullPath: string
  branch: string | null
  head: string | null
  created: false
}

function createByteCounter(onProgress: (bytesSent: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let bytesSent = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesSent += chunk.byteLength
      onProgress(bytesSent)
      controller.enqueue(chunk)
    },
  })
}

export const MANAGER_FEATURE_MISSING = 'MANAGER_FEATURE_MISSING'

const DEFAULT_FEATURE_NAME = 'ocm goals and multi-runs'
const MOVE_FEATURE_NAME = '/ocm-move worktrees'

function directoryQuery(directory: string | undefined): string {
  return directory ? `?${new URLSearchParams({ directory }).toString()}` : ''
}

export class ManagerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly operation: string,
    public readonly details: unknown = null,
    public readonly jsonBody: boolean = false,
  ) {
    super(message)
    this.name = 'ManagerApiError'
  }
}

export function isManagerRouteMissing(error: unknown): boolean {
  if (!(error instanceof ManagerApiError)) return false
  if (error.code === MANAGER_FEATURE_MISSING) return true
  return error.status === 404 && !error.jsonBody
}

async function formatErrorResponse(res: Response, operation: string): Promise<ManagerApiError> {
  const text = await res.text().catch(() => '')
  let code: string | null = null
  let detail = text
  let details: unknown = null
  let jsonBody = false
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        jsonBody = true
        const body = parsed as { error?: unknown; message?: unknown; code?: unknown; details?: unknown }
        const codeField = typeof body.code === 'string' ? body.code : null
        const errField = typeof body.error === 'string' ? body.error : null
        const msgField = typeof body.message === 'string' ? body.message : null
        code = codeField
        detail = msgField ?? errField ?? text
        details = body.details ?? null
      }
    } catch {
      /* not JSON, keep raw text */
    }
  }
  const message = detail
    ? `${operation} failed (${res.status}): ${detail}`
    : `${operation} failed (${res.status})`
  return new ManagerApiError(message, res.status, code, operation, details, jsonBody)
}

export class ManagerApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  private async requestJson<T>(
    path: string,
    operation: string,
    parse: (body: unknown) => T,
    init?: RequestInit & { feature?: boolean; featureName?: string },
  ): Promise<T> {
    const { feature, featureName, ...requestInit } = init ?? {}
    const baseHeaders = this.headers(
      typeof requestInit.body === 'string' ? { 'Content-Type': 'application/json' } : {},
    )
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers: { ...baseHeaders, ...(requestInit.headers as Record<string, string> | undefined) },
    })
    if (!res.ok) {
      const featureLabel = feature === true ? (featureName ?? DEFAULT_FEATURE_NAME) : null
      throw await this.handleErrorResponse(res, operation, featureLabel, requestInit.signal ?? undefined)
    }
    return parse(await res.json())
  }

  private async handleErrorResponse(
    res: Response,
    operation: string,
    featureName: string | null,
    signal?: AbortSignal,
  ): Promise<ManagerApiError> {
    const error = await formatErrorResponse(res, operation)
    if (featureName !== null && error.status === 401) {
      return this.probeFeatureSupport(operation, featureName, error, signal)
    }
    return error
  }

  private async probeFeatureSupport(
    operation: string,
    featureName: string,
    fallback: ManagerApiError,
    signal?: AbortSignal,
  ): Promise<ManagerApiError> {
    try {
      const res = await fetch(`${this.baseUrl}/api/internal/opencode-workspaces`, { headers: this.headers(), signal })
      if (res.ok) {
        return new ManagerApiError(
          `${operation} failed: this OpenCode Manager is too old for ${featureName}; upgrade the Manager.`,
          401,
          MANAGER_FEATURE_MISSING,
          operation,
        )
      }
    } catch {
      return fallback
    }
    return fallback
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

  async mirrorPatch(
    repoId: number,
    body: { baseHead: string | null; patch: string; force?: boolean; directory?: string },
  ): Promise<MirrorPatchResult> {
    const payload: Record<string, unknown> = { baseHead: body.baseHead, patch: body.patch, force: body.force === true }
    if (body.directory) payload.directory = body.directory
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/patch`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror patch')
    return (await res.json()) as MirrorPatchResult
  }

  async mirrorUploadBundle(
    repoId: number,
    bundlePath: string,
    opts: {
      branch: string | null
      force?: boolean
      requireCurrentBranch?: boolean
      directory?: string
      targetBranch?: string
      onProgress?: (bytesSent: number) => void
    },
  ): Promise<MirrorBundleResult> {
    const params = new URLSearchParams()
    if (opts.force === true) params.set('force', '1')
    if (opts.directory) params.set('directory', opts.directory)
    const query = params.size > 0 ? `?${params.toString()}` : ''
    const headers: Record<string, string> = { ...this.headers(), 'Content-Type': 'application/octet-stream' }
    if (opts.branch) headers['X-OCM-Branch'] = opts.branch
    if (opts.requireCurrentBranch === true) headers['X-OCM-Require-Current-Branch'] = '1'
    if (opts.targetBranch) headers['X-OCM-Target-Branch'] = opts.targetBranch
    const fileStream = Readable.toWeb(createReadStream(bundlePath)) as unknown as ReadableStream<Uint8Array>
    const body = opts.onProgress ? fileStream.pipeThrough(createByteCounter(opts.onProgress)) : fileStream
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/bundle${query}`, {
      method: 'POST',
      headers,
      body: body as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror bundle upload')
    return (await res.json()) as MirrorBundleResult
  }

  async mirrorHead(repoId: number, directory?: string): Promise<MirrorHead> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/head${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror head')
    return (await res.json()) as MirrorHead
  }

  async mirrorCheckouts(repoId: number, branch: string): Promise<MirrorCheckoutsResponse> {
    const params = new URLSearchParams({ branch })
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/checkouts?${params.toString()}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await this.handleErrorResponse(res, 'mirror checkouts', MOVE_FEATURE_NAME)
    return MirrorCheckoutsResponseSchema.parse(await res.json())
  }

  async mirrorCreateWorktree(
    repoId: number,
    bundlePath: string,
    opts: { branch: string; targetBranch: string; onProgress?: (bytesSent: number) => void },
  ): Promise<MirrorWorktreeCreateResponse> {
    const headers: Record<string, string> = {
      ...this.headers(),
      'Content-Type': 'application/octet-stream',
      'X-OCM-Branch': opts.branch,
      'X-OCM-Target-Branch': opts.targetBranch,
    }
    const fileStream = Readable.toWeb(createReadStream(bundlePath)) as unknown as ReadableStream<Uint8Array>
    const body = opts.onProgress ? fileStream.pipeThrough(createByteCounter(opts.onProgress)) : fileStream
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/worktree`, {
      method: 'POST',
      headers,
      body: body as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    if (!res.ok) throw await this.handleErrorResponse(res, 'mirror create worktree', MOVE_FEATURE_NAME)
    return MirrorWorktreeCreateResponseSchema.parse(await res.json())
  }

  async mirrorContains(repoId: number, sha: string, directory?: string): Promise<{ contained: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/contains/${sha}${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror contains')
    return (await res.json()) as { repoId: number; contained: boolean }
  }

  async mirrorDownloadBundle(repoId: number, directory?: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/bundle${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror bundle download')
    return res.body!
  }

  async mirrorPatchSnapshot(repoId: number, directory?: string): Promise<MirrorPatchSnapshot> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/patch${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror patch snapshot')
    return (await res.json()) as MirrorPatchSnapshot
  }

  getLatestSessionGoal(sessionId: string, signal?: AbortSignal): Promise<SessionGoal | null> {
    return this.requestJson(
      `/api/internal/session-goals?sessionId=${encodeURIComponent(sessionId)}`,
      'read session goal',
      (body) => SessionGoalSchema.nullable().parse((body as { goal: unknown }).goal),
      { signal, feature: true },
    )
  }

  startSessionGoal(input: StartSessionGoalRequest): Promise<SessionGoal> {
    return this.requestJson(
      '/api/internal/session-goals',
      'start session goal',
      (body) => SessionGoalSchema.parse((body as { goal: unknown }).goal),
      { method: 'POST', body: JSON.stringify(input), feature: true },
    )
  }

  private runSessionGoalAction(id: number, action: 'pause' | 'resume' | 'cancel'): Promise<SessionGoal> {
    return this.requestJson(
      `/api/internal/session-goals/${encodeURIComponent(id)}/${action}`,
      `${action} session goal`,
      (body) => SessionGoalSchema.parse((body as { goal: unknown }).goal),
      { method: 'POST', feature: true },
    )
  }

  pauseSessionGoal(id: number): Promise<SessionGoal> {
    return this.runSessionGoalAction(id, 'pause')
  }

  resumeSessionGoal(id: number): Promise<SessionGoal> {
    return this.runSessionGoalAction(id, 'resume')
  }

  cancelSessionGoal(id: number): Promise<SessionGoal> {
    return this.runSessionGoalAction(id, 'cancel')
  }

  listMultiRuns(repoId: number): Promise<MultiRun[]> {
    return this.requestJson(
      `/api/internal/multi-runs?repoId=${encodeURIComponent(repoId)}`,
      'list multi-runs',
      (body) => MultiRunSchema.array().parse((body as { runs: unknown }).runs),
      { feature: true },
    )
  }

  launchMultiRun(request: LaunchMultiRunRequest): Promise<MultiRun> {
    return this.requestJson(
      '/api/internal/multi-runs',
      'launch multi-run',
      (body) => MultiRunSchema.parse((body as { run: unknown }).run),
      { method: 'POST', body: JSON.stringify(request), feature: true },
    )
  }

  fuseMultiRun(runId: number, request: FuseMultiRunRequest): Promise<MultiRun> {
    return this.requestJson(
      `/api/internal/multi-runs/${encodeURIComponent(runId)}/fusions`,
      'fuse multi-run',
      (body) => MultiRunSchema.parse((body as { run: unknown }).run),
      { method: 'POST', body: JSON.stringify(request), feature: true },
    )
  }

  discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
    return this.requestJson(
      `/api/internal/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`,
      'discard multi-run entry',
      (body) => MultiRunSchema.parse((body as { run: unknown }).run),
      { method: 'POST', feature: true },
    )
  }
}
