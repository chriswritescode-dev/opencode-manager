import { createHmac, randomBytes } from 'node:crypto'
import { ENV } from '@opencode-manager/shared/config/env'

const HMAC_SECRET_SALT = Buffer.from('repo-target-token-v1', 'utf8')

function deriveKey(): Buffer {
  const secret = ENV.AUTH.SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET must be configured for repo target tokens')
  }
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(HMAC_SECRET_SALT).digest()
}

export function createRepoTargetToken(repoId: number): string {
  const nonce = randomBytes(16).toString('hex')
  const payload = `${repoId}:${nonce}`
  const key = deriveKey()
  const signature = createHmac('sha256', key).update(payload).digest('hex')
  return `${repoId}:${nonce}:${signature}`
}

export function verifyRepoTargetToken(token: string): { repoId: number } | null {
  const parts = token.split(':')
  if (parts.length !== 3) return null

  const [repoIdStr, nonce, signature] = parts
  const repoId = parseInt(repoIdStr!, 10)
  if (isNaN(repoId)) return null

  const payload = `${repoId}:${nonce}`
  const key = deriveKey()
  const expectedSignature = createHmac('sha256', key).update(payload).digest('hex')

  if (!timingSafeEqual(Buffer.from(signature!, 'hex'), Buffer.from(expectedSignature, 'hex'))) return null

  return { repoId }
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!
  }
  return result === 0
}
