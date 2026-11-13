import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { z } from 'zod'
import {
  MirrorCheckoutsResponseSchema,
  MirrorWorktreeCreateResponseSchema,
  MultiRunSchema,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MirrorCheckoutsResponse,
  type MirrorWorktreeCreateResponse,
  type MultiRun,
} from '@opencode-manager/shared/schemas'
import { JsonValueSchema, parseJsonText, type JsonValue } from '@opencode-manager/shared/utils'

export interface MirrorBeginOpts {
  force?: boolean
  create?: { name: string; originUrl: string | null; branch: string | null }
}

const MirrorBeginResultSchema = z.object({
  uploadId: z.string(),
  repoId: z.number(),
  chunkSize: z.number(),
  created: z.boolean(),
})

export type MirrorBeginResult = z.infer<typeof MirrorBeginResultSchema>

const MirrorCommitResultSchema = z.object({
  repoId: z.number(),
  fullPath: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  created: z.boolean(),
})

export type MirrorCommitResult = z.infer<typeof MirrorCommitResultSchema>

const MirrorPatchResultSchema = z.object({
  repoId: z.number(),
  fullPath: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  created: z.literal(false),
  applied: z.literal(true),
})

export type MirrorPatchResult = z.infer<typeof MirrorPatchResultSchema>

const MirrorPatchSnapshotSchema = z.object({
  repoId: z.number(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  patch: z.string(),
})

export type MirrorPatchSnapshot = z.infer<typeof MirrorPatchSnapshotSchema>

const MirrorHeadSchema = z.object({
  repoId: z.number(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  dirty: z.boolean(),
})

export type MirrorHead = z.infer<typeof MirrorHeadSchema>

const MirrorBundleResultSchema = z.object({
  repoId: z.number(),
  fullPath: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  created: z.literal(false),
})

export type MirrorBundleResult = z.infer<typeof MirrorBundleResultSchema>

const MirrorContainsResultSchema = z.object({
  repoId: z.number(),
  contained: z.boolean(),
})

export type MirrorContainsResult = z.infer<typeof MirrorContainsResultSchema>

const MultiRunsResponseSchema = z.object({ runs: z.array(MultiRunSchema) })

const MultiRunResponseSchema = z.object({ run: MultiRunSchema })

const ManagerErrorBodySchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  details: JsonValueSchema.optional(),
})

interface MirrorBeginPayload {
  force: boolean
  create?: true
  name?: string
  originUrl?: string
  branch?: string
}

interface MirrorPatchPayload {
  baseHead: string | null
  patch: string
  force: boolean
  directory?: string
}

interface ManagerHeaders {
  [name: string]: string
}

interface StreamingRequestInit extends RequestInit {
  duplex?: 'half'
}

function toRequestBody(stream: Readable, onProgress?: (bytesSent: number) => void): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]()
  let bytesSent = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done === true) {
        controller.close()
        return
      }
      const chunk: Uint8Array = next.value
      bytesSent += chunk.byteLength
      onProgress?.(bytesSent)
      controller.enqueue(chunk)
    },
    async cancel() {
      await iterator.return?.(undefined)
    },
  })
}

function headerRecord(headers: HeadersInit | undefined): ManagerHeaders {
  if (headers === undefined) return {}
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  const tupleEntries = z.array(z.tuple([z.string(), z.string()])).safeParse(headers)
  if (tupleEntries.success) return Object.fromEntries(tupleEntries.data)
  const record = z.record(z.string(), z.string()).safeParse(headers)
  return record.success ? record.data : {}
}

export const MANAGER_FEATURE_MISSING = 'MANAGER_FEATURE_MISSING'

const DEFAULT_FEATURE_NAME = 'ocm multi-runs'
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
    public readonly details: JsonValue | null = null,
    public readonly jsonBody: boolean = false,
  ) {
    super(message)
    this.name = 'ManagerApiError'
  }
}

export function isManagerRouteMissing(cause: unknown): boolean {
  if (!(cause instanceof ManagerApiError)) return false
  if (cause.code === MANAGER_FEATURE_MISSING) return true
  return cause.status === 404 && !cause.jsonBody
}

async function formatErrorResponse(res: Response, operation: string): Promise<ManagerApiError> {
  const text = await res.text().catch(() => '')
  let code: string | null = null
  let detail = text
  let details: JsonValue | null = null
  let jsonBody = false
  if (text) {
    const body = ManagerErrorBodySchema.safeParse(parseJsonText(text))
    if (body.success) {
      jsonBody = true
      code = body.data.code ?? null
      detail = body.data.message ?? body.data.error ?? text
      details = body.data.details ?? null
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

  private headers(extra: Record<string, string> = {}): ManagerHeaders {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  private async requestJson<T>(
    path: string,
    operation: string,
    parse: (body: JsonValue) => T,
    init?: RequestInit & { feature?: boolean; featureName?: string },
  ): Promise<T> {
    const { feature, featureName, ...requestInit } = init ?? {}
    const jsonBody = z.string().safeParse(requestInit.body)
    const baseHeaders = this.headers(jsonBody.success ? { 'Content-Type': 'application/json' } : {})
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers: { ...baseHeaders, ...headerRecord(requestInit.headers) },
    })
    if (!res.ok) {
      const featureLabel = feature === true ? (featureName ?? DEFAULT_FEATURE_NAME) : null
      throw await this.handleErrorResponse(res, operation, featureLabel)
    }
    return parse(await res.json())
  }

  private async handleErrorResponse(
    res: Response,
    operation: string,
    featureName: string | null,
  ): Promise<ManagerApiError> {
    const error = await formatErrorResponse(res, operation)
    if (featureName !== null && error.status === 401) {
      return this.probeFeatureSupport(operation, featureName, error)
    }
    return error
  }

  private async probeFeatureSupport(
    operation: string,
    featureName: string,
    fallback: ManagerApiError,
  ): Promise<ManagerApiError> {
    try {
      const res = await fetch(`${this.baseUrl}/api/internal/opencode-workspaces`, { headers: this.headers() })
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
    const body: MirrorBeginPayload = { force: opts.force === true }
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
    return MirrorBeginResultSchema.parse(await res.json())
  }

  async mirrorUploadPart(repoId: number, uploadId: string, index: number, chunk: Buffer): Promise<void> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/parts/${uploadId}/${index}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(chunk),
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
    return MirrorCommitResultSchema.parse(await res.json())
  }

  async mirrorAbort(repoId: number, uploadId: string): Promise<void> {
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror/uploads/${uploadId}`
    await fetch(url, { method: 'DELETE', headers: this.headers() }).catch(() => { })
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
    const payload: MirrorPatchPayload = { baseHead: body.baseHead, patch: body.patch, force: body.force === true }
    if (body.directory) payload.directory = body.directory
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/patch`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror patch')
    return MirrorPatchResultSchema.parse(await res.json())
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
    const headers: ManagerHeaders = { ...this.headers(), 'Content-Type': 'application/octet-stream' }
    if (opts.branch) headers['X-OCM-Branch'] = opts.branch
    if (opts.requireCurrentBranch === true) headers['X-OCM-Require-Current-Branch'] = '1'
    if (opts.targetBranch) headers['X-OCM-Target-Branch'] = opts.targetBranch
    const body = toRequestBody(createReadStream(bundlePath), opts.onProgress)
    const requestInit: StreamingRequestInit = {
      method: 'POST',
      headers,
      body,
      duplex: 'half',
    }
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/bundle${query}`, requestInit)

    if (!res.ok) throw await formatErrorResponse(res, 'mirror bundle upload')
    return MirrorBundleResultSchema.parse(await res.json())
  }

  async mirrorHead(repoId: number, directory?: string): Promise<MirrorHead> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/head${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror head')
    return MirrorHeadSchema.parse(await res.json())
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
    opts: { branch: string; targetBranch: string; patch: string; onProgress?: (bytesSent: number) => void },
  ): Promise<MirrorWorktreeCreateResponse> {
    const patchBuf = Buffer.from(opts.patch, 'utf-8')
    const headers: ManagerHeaders = {
      ...this.headers(),
      'Content-Type': 'application/octet-stream',
      'X-OCM-Branch': opts.branch,
      'X-OCM-Target-Branch': opts.targetBranch,
      'X-OCM-Patch-Bytes': String(patchBuf.length),
    }
    const source = Readable.from(
      (async function* () {
        if (patchBuf.length > 0) yield patchBuf
        yield* createReadStream(bundlePath)
      })(),
    )
    const body = toRequestBody(source, opts.onProgress)
    const requestInit: StreamingRequestInit = {
      method: 'POST',
      headers,
      body,
      duplex: 'half',
    }
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/worktree`, requestInit)

    if (!res.ok) throw await this.handleErrorResponse(res, 'mirror create worktree', MOVE_FEATURE_NAME)
    return MirrorWorktreeCreateResponseSchema.parse(await res.json())
  }

  async mirrorContains(repoId: number, sha: string, directory?: string): Promise<MirrorContainsResult> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror/contains/${sha}${directoryQuery(directory)}`, {
      headers: this.headers(),
    })

    if (!res.ok) throw await formatErrorResponse(res, 'mirror contains')
    return MirrorContainsResultSchema.parse(await res.json())
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
    return MirrorPatchSnapshotSchema.parse(await res.json())
  }

  listMultiRuns(repoId: number): Promise<MultiRun[]> {
    return this.requestJson(
      `/api/internal/multi-runs?repoId=${encodeURIComponent(repoId)}`,
      'list multi-runs',
      (body) => MultiRunsResponseSchema.parse(body).runs,
      { feature: true },
    )
  }

  launchMultiRun(request: LaunchMultiRunRequest): Promise<MultiRun> {
    return this.requestJson(
      '/api/internal/multi-runs',
      'launch multi-run',
      (body) => MultiRunResponseSchema.parse(body).run,
      { method: 'POST', body: JSON.stringify(request), feature: true },
    )
  }

  fuseMultiRun(runId: number, request: FuseMultiRunRequest): Promise<MultiRun> {
    return this.requestJson(
      `/api/internal/multi-runs/${encodeURIComponent(runId)}/fusions`,
      'fuse multi-run',
      (body) => MultiRunResponseSchema.parse(body).run,
      { method: 'POST', body: JSON.stringify(request), feature: true },
    )
  }

  discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
    return this.requestJson(
      `/api/internal/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`,
      'discard multi-run entry',
      (body) => MultiRunResponseSchema.parse(body).run,
      { method: 'POST', feature: true },
    )
  }
}
