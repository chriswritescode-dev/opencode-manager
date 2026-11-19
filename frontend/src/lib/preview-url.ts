import type { CreatePreviewSessionResponse } from '@opencode-manager/shared/types'

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

export interface LocalDevUrl {
  port: number
  path: string
}

export interface PreviewOriginInput {
  previewPort: number
  publicUrl: string | null
}

export function parsePort(value: string): number | null {
  if (!value) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

export function parseLocalDevUrl(url: string): LocalDevUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!LOCAL_DEV_HOSTS.has(parsed.hostname)) return null
  const port = parsePort(parsed.port)
  if (port === null) return null
  return { port, path: `${parsed.pathname}${parsed.search}${parsed.hash}` }
}

export type ManagerLocation = Pick<Location, 'protocol' | 'hostname' | 'origin'>

export function getPreviewOrigin(input: PreviewOriginInput, location: ManagerLocation = window.location): string {
  if (input.publicUrl) {
    return new URL(input.publicUrl, location.origin).origin
  }
  return `${location.protocol}//${location.hostname}:${input.previewPort}`
}

export function buildPreviewStartUrl(
  session: CreatePreviewSessionResponse,
  path: string,
  location: ManagerLocation = window.location,
): string {
  const origin = getPreviewOrigin(session, location)
  const query = new URLSearchParams({ token: session.token, path })
  return `${origin}/__ocm_preview/start?${query.toString()}`
}

export function isSameOriginAsManager(origin: string, location: ManagerLocation = window.location): boolean {
  try {
    return new URL(origin).origin === location.origin
  } catch {
    return false
  }
}
