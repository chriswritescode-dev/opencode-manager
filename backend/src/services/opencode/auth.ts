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
