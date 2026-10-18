import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'

export type OpenCodePasswordResolver = () => string | Promise<string>

export function getOpenCodeBasicAuthHeader(password: string): string
export function getOpenCodeBasicAuthHeader(passwordResolver: OpenCodePasswordResolver): Promise<string>
export function getOpenCodeBasicAuthHeader(source: string | OpenCodePasswordResolver): string | Promise<string> {
  if (typeof source === 'function') {
    return Promise.resolve(source()).then((password) => buildOpenCodeBasicAuth(password))
  }

  return buildOpenCodeBasicAuth(source)
}

/** Builds the Basic authorization header for a server that uses a username other than the default `opencode`. */
export function getOpenCodeServerBasicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}
