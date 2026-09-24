import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'

export type RewriteContext = { localRoot: string; remoteRoot: string }

export function rewriteTransferForRemote(data: SessionTransferData, ctx: RewriteContext): SessionTransferData {
  const cloned = structuredClone(data)
  cloned.info.location.directory = relocatePath(cloned.info.location.directory, ctx)
  relocateUris(cloned.messages, ctx)
  return cloned
}

function relocateUris(value: unknown, ctx: RewriteContext): void {
  if (Array.isArray(value)) {
    for (const item of value) relocateUris(item, ctx)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.uri === 'string') record.uri = relocateUri(record.uri, ctx)
  for (const child of Object.values(record)) relocateUris(child, ctx)
}

function relocateUri(uri: string, ctx: RewriteContext): string {
  const fileUrl = parseLocalFileUrl(uri)
  if (!fileUrl) return relocatePath(uri, ctx)

  const relocated = relocatePath(fileUrl.path, ctx)
  if (relocated === fileUrl.path) return uri
  return `${pathToFileURL(relocated).href}${fileUrl.search}${fileUrl.hash}`
}

function parseLocalFileUrl(uri: string): { path: string; search: string; hash: string } | null {
  if (!uri.startsWith('file:')) return null

  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'file:' || (url.host !== '' && url.host !== 'localhost')) return null

  let path: string
  try {
    path = fileURLToPath(url)
  } catch {
    return null
  }
  return { path, search: url.search, hash: url.hash }
}

function relocatePath(path: string, ctx: RewriteContext): string {
  if (path === ctx.localRoot) return ctx.remoteRoot
  if (path.startsWith(ctx.localRoot + '/')) return ctx.remoteRoot + path.slice(ctx.localRoot.length)
  return path
}

export type TransferDeps = {
  exportSession: (sessionID: string) => Promise<SessionTransferData>
  importSession: (remoteDirectory: string, data: SessionTransferData) => Promise<{ sessionID: string }>
  onProgress?: (transferred: number, total: number) => void
}

export type TransferInput = { sessionID: string; localRoot: string; remoteDirectory: string }

export type TransferResult =
  | { kind: 'moved'; sessionID: string; importedMessages: number }
  | { kind: 'import-failed'; message: string }

export async function transferSession(input: TransferInput, deps: TransferDeps): Promise<TransferResult> {
  let data: SessionTransferData
  try {
    data = await deps.exportSession(input.sessionID)
  } catch (err) {
    return { kind: 'import-failed', message: err instanceof Error ? err.message : String(err) }
  }

  const rewritten = rewriteTransferForRemote(data, {
    localRoot: input.localRoot,
    remoteRoot: input.remoteDirectory,
  })
  const total = rewritten.messages.length
  deps.onProgress?.(0, total)

  try {
    await deps.importSession(input.remoteDirectory, rewritten)
  } catch (err) {
    return { kind: 'import-failed', message: err instanceof Error ? err.message : String(err) }
  }

  deps.onProgress?.(total, total)
  return { kind: 'moved', sessionID: input.sessionID, importedMessages: total }
}

export function moveReminderText(directory: string): string {
  return `<system-reminder>The user has changed the current working directory to "${directory}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`
}
