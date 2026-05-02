import { ENV } from '@opencode-manager/shared/config/env'

export function buildOpenCodeBasicAuthHeader(): string | null {
  const password = ENV.OPENCODE.SERVER_PASSWORD
  const username = ENV.OPENCODE.SERVER_USERNAME
  if (!password) return null
  const token = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${token}`
}
