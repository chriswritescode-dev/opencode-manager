import { z } from 'zod'

export const SSHHostKeyRequestSchema = z.object({
  id: z.string(),
  host: z.string(),
  ip: z.string(),
  keyType: z.string(),
  fingerprint: z.string(),
  timestamp: z.number(),
  isKeyChanged: z.boolean()
})

export const SSHHostKeyResponseSchema = z.enum(['accept', 'reject'])

export const TrustedSSHHostSchema = z.object({
  id: z.number(),
  host: z.string(),
  key_type: z.string(),
  fingerprint: z.string(),
  created_at: z.number(),
  updated_at: z.number()
})

export type SSHHostKeyRequest = z.infer<typeof SSHHostKeyRequestSchema>
export type SSHHostKeyResponse = z.infer<typeof SSHHostKeyResponseSchema>
export type TrustedSSHHost = z.infer<typeof TrustedSSHHostSchema>
