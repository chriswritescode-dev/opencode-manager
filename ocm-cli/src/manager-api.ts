import { createReadStream } from 'fs'
import { Readable } from 'stream'
import {
  MirrorTargetEnsureResponseSchema,
  MirrorTargetPlanResponseSchema,
  MultiRunSchema,
  SessionGoalSchema,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MirrorTargetEnsureResponse,
  type MirrorTargetPlanResponse,
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

export class ManagerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly operation: string,
    public readonly details: unknown = null,
  ) {
    super(message)
    this.name = 'ManagerApiError'
  }
}

export function isManagerRouteMissing(error: unknown): boolean {
  return error instanceof ManagerApiError && error.status === 404 && error.code === null
}

async function formatErrorResponse(res: Response, operation: string): Promise<ManagerApiError> {
  const text = await res.text().catch(() => '')
  let code: string | null = null
  let detail = text
  let details: unknown = null
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; details?: unknown }
      const errField = typeof parsed.error === 'string' ? parsed.error : null
      const msgField = typeof parsed.message === 'string' ? parsed.message : null
      code = errField
      detail = msgField ?? errField ?? text
      details = parsed.details ?? null
    } catch {
      /* not JSON, keep raw text */
    }
  }
  const message = detail
    ? `${operation} failed (${res.status}): ${detail}`
    : `${operation} failed (${res.status})`
  return new ManagerApiError(message, res.status, code, operation, details)
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

  async mirrorPatch(repoId: number, body: { baseHead: string | null; patch: string; force?: boolean }): Promise<MirrorPatchResult> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/patch`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseHead: body.baseHead, patch: body.patch, force: body.force === true }),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror patch')
    return (await res.json()) as MirrorPatchResult
  }

  async mirrorUploadBundle(
    repoId: number,
    bundlePath: string,
    opts: { branch: string | null; force?: boolean; requireCurrentBranch?: boolean; onProgress?: (bytesSent: number) => void },
  ): Promise<MirrorBundleResult> {
    const query = opts.force === true ? '?force=1' : ''
    const headers: Record<string, string> = { ...this.headers(), 'Content-Type': 'application/octet-stream' }
    if (opts.branch) headers['X-OCM-Branch'] = opts.branch
    if (opts.requireCurrentBranch === true) headers['X-OCM-Require-Current-Branch'] = '1'
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

  async mirrorHead(repoId: number): Promise<MirrorHead> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/head`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror head')
    return (await res.json()) as MirrorHead
  }

  async mirrorTargetPlan(repoId: number, branch: string): Promise<MirrorTargetPlanResponse> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/target?branch=${encodeURIComponent(branch)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror target plan')
    return MirrorTargetPlanResponseSchema.parse(await res.json())
  }

  async mirrorEnsureTarget(repoId: number, branch: string): Promise<MirrorTargetEnsureResponse> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/target`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror target')
    return MirrorTargetEnsureResponseSchema.parse(await res.json())
  }

  async mirrorContains(repoId: number, sha: string): Promise<{ contained: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/contains/${sha}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror contains')
    return (await res.json()) as { repoId: number; contained: boolean }
  }

  async mirrorDownloadBundle(repoId: number): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/bundle`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror bundle download')
    return res.body!
  }

  async mirrorPatchSnapshot(repoId: number): Promise<MirrorPatchSnapshot> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/patch`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror patch snapshot')
    return (await res.json()) as MirrorPatchSnapshot
  }

  async getLatestSessionGoal(sessionId: string): Promise<SessionGoal | null> {
    const res = await fetch(`${this.baseUrl}/api/internal/session-goals?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'read session goal')
    const body = (await res.json()) as { goal: unknown }
    return SessionGoalSchema.nullable().parse(body.goal)
  }

  async startSessionGoal(input: StartSessionGoalRequest): Promise<SessionGoal> {
    const res = await fetch(`${this.baseUrl}/api/internal/session-goals`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'start session goal')
    const body = (await res.json()) as { goal: unknown }
    return SessionGoalSchema.parse(body.goal)
  }

  private async runSessionGoalAction(id: number, action: 'pause' | 'resume' | 'cancel'): Promise<SessionGoal> {
    const res = await fetch(`${this.baseUrl}/api/internal/session-goals/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, `${action} session goal`)
    const body = (await res.json()) as { goal: unknown }
    return SessionGoalSchema.parse(body.goal)
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

  async listMultiRuns(repoId: number): Promise<MultiRun[]> {
    const res = await fetch(`${this.baseUrl}/api/internal/multi-runs?repoId=${encodeURIComponent(repoId)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'list multi-runs')
    const body = (await res.json()) as { runs: unknown }
    return MultiRunSchema.array().parse(body.runs)
  }

  async launchMultiRun(request: LaunchMultiRunRequest): Promise<MultiRun> {
    const res = await fetch(`${this.baseUrl}/api/internal/multi-runs`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'launch multi-run')
    const body = (await res.json()) as { run: unknown }
    return MultiRunSchema.parse(body.run)
  }

  async fuseMultiRun(runId: number, request: FuseMultiRunRequest): Promise<MultiRun> {
    const res = await fetch(`${this.baseUrl}/api/internal/multi-runs/${encodeURIComponent(runId)}/fusions`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'fuse multi-run')
    const body = (await res.json()) as { run: unknown }
    return MultiRunSchema.parse(body.run)
  }

  async discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
    const res = await fetch(`${this.baseUrl}/api/internal/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`, {
      method: 'POST',
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'discard multi-run entry')
    const body = (await res.json()) as { run: unknown }
    return MultiRunSchema.parse(body.run)
  }
}
