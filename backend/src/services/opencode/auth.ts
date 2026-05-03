import { ENV } from '@opencode-manager/shared/config/env'

export type OpenCodePasswordResolver = () => string | Promise<string>

export function getOpenCodeBasicAuthHeader(): string | null
export function getOpenCodeBasicAuthHeader(password: string): string | null
export function getOpenCodeBasicAuthHeader(passwordResolver: OpenCodePasswordResolver): Promise<string | null>
export function getOpenCodeBasicAuthHeader(source?: string | OpenCodePasswordResolver): string | null | Promise<string | null> {
  if (typeof source === 'function') {
    return Promise.resolve(source()).then((password) => getOpenCodeBasicAuthHeader(password))
  }

  const password = source ?? ENV.OPENCODE.SERVER_PASSWORD
  const username = ENV.OPENCODE.SERVER_USERNAME
  if (!password) return null
  const token = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${token}`
}
