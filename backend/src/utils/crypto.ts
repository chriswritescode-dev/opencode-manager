import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { ENV } from '@opencode-manager/shared/config/env'

const ENCRYPTION_KEY_SALT = Buffer.from('opencode-ssh-key-salt-v1', 'utf8')
const IV_LENGTH = 16
const KEY_LENGTH = 32

function deriveKey(): Buffer {
  const secret = ENV.AUTH.SECRET || 'default-secret-do-not-use-in-production'
  return scryptSync(secret, ENCRYPTION_KEY_SALT, KEY_LENGTH)
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  
  const updateResult = cipher.update(plaintext, 'utf8')
  const encrypted = Buffer.concat([updateResult, cipher.final()])
  
  const authTag = cipher.getAuthTag()
  
  const combined = Buffer.concat([iv, authTag, encrypted])
  return combined.toString('base64')
}

export function decryptSecret(encrypted: string): string {
  const combined = Buffer.from(encrypted, 'base64')
  
  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Invalid encrypted data format')
  }
  
  const iv = combined.slice(0, IV_LENGTH)
  const authTag = combined.slice(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = combined.slice(IV_LENGTH + 16)
  
  const key = deriveKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  
  const updateResult = decipher.update(ciphertext)
  const decrypted = Buffer.concat([updateResult, decipher.final()])
  
  return decrypted.toString('utf8')
}
