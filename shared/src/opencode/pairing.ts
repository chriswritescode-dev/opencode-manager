import { z } from 'zod'
import { JsonValueSchema, type JsonValue } from '../utils/json'

const PAIRING_PROTOCOL = 'ocm-pair-v2'
const PAIRING_PROOF_PREFIX = `${PAIRING_PROTOCOL}:`
const PAIRING_KEY_INFO = `${PAIRING_PROTOCOL} credentials`
const PAIRING_NONCE_BYTES = 32
const PAIRING_IV_BYTES = 12
const PAIRING_KEY_BITS = 256

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type WebCryptoKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>

export type OpenCodePairingCredentials = {
  username: string
  password: string
}

const OpenCodePairingCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string(),
})

export interface OpenCodePairingEncryptedCredentials {
  iv: string
  ciphertext: string
}

export interface OpenCodePairingKeyOptions {
  code: string
  nonce: string
}

export interface OpenCodePairingDecryptOptions extends OpenCodePairingKeyOptions {
  iv: string
  ciphertext: string
}

export function createOpenCodePairingNonce(): string {
  return base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(PAIRING_NONCE_BYTES)))
}

export function isOpenCodePairingNonce(value: string): boolean {
  const nonce = z.string().safeParse(value)
  if (!nonce.success) return false
  const bytes = base64UrlDecode(nonce.data)
  return bytes !== null && bytes.length === PAIRING_NONCE_BYTES
}

export function isOpenCodePairingCredentials(value: JsonValue | undefined): value is OpenCodePairingCredentials {
  return OpenCodePairingCredentialsSchema.safeParse(value).success
}

export async function createOpenCodePairingProof(code: string, nonce: string): Promise<string> {
  const key = await importHmacKey(code)
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, pairingProofMessage(nonce))
  return base64UrlEncode(new Uint8Array(signature))
}

export async function verifyOpenCodePairingProof(code: string, nonce: string, proof: string): Promise<boolean> {
  const signature = base64UrlDecode(proof)
  if (signature === null) return false
  const key = await importHmacKey(code)
  try {
    return await globalThis.crypto.subtle.verify('HMAC', key, signature, pairingProofMessage(nonce))
  } catch {
    return false
  }
}

export async function encryptOpenCodePairingCredentials(
  options: OpenCodePairingKeyOptions & { credentials: OpenCodePairingCredentials },
): Promise<OpenCodePairingEncryptedCredentials> {
  const key = await deriveCredentialsKey(options.code, options.nonce)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(PAIRING_IV_BYTES))
  const plaintext = encodeText(JSON.stringify({
    username: options.credentials.username,
    password: options.credentials.password,
  }))
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: pairingAdditionalData() },
    key,
    plaintext,
  )
  return {
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  }
}

export async function decryptOpenCodePairingCredentials(
  options: OpenCodePairingDecryptOptions,
): Promise<OpenCodePairingCredentials> {
  const iv = base64UrlDecode(options.iv)
  const ciphertext = base64UrlDecode(options.ciphertext)
  if (iv === null || iv.length !== PAIRING_IV_BYTES || ciphertext === null) {
    throw new Error('Invalid pairing payload')
  }
  const key = await deriveCredentialsKey(options.code, options.nonce)
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: pairingAdditionalData() },
    key,
    ciphertext,
  )
  const parsed = JsonValueSchema.safeParse(JSON.parse(textDecoder.decode(plaintext)))
  if (!parsed.success || !isOpenCodePairingCredentials(parsed.data)) throw new Error('Invalid pairing payload')
  return parsed.data
}

function encodeText(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(textEncoder.encode(value))
}

function pairingProofMessage(nonce: string): Uint8Array<ArrayBuffer> {
  return encodeText(`${PAIRING_PROOF_PREFIX}${nonce}`)
}

function pairingAdditionalData(): Uint8Array<ArrayBuffer> {
  return encodeText(PAIRING_PROTOCOL)
}

async function importHmacKey(code: string): Promise<WebCryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    encodeText(code),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function deriveCredentialsKey(code: string, nonce: string): Promise<WebCryptoKey> {
  const keyMaterial = await globalThis.crypto.subtle.importKey('raw', encodeText(code), 'HKDF', false, ['deriveKey'])
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encodeText(nonce),
      info: encodeText(PAIRING_KEY_INFO),
    },
    keyMaterial,
    { name: 'AES-GCM', length: PAIRING_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}
