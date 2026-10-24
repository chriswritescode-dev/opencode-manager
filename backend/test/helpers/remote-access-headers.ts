import type { RemoteAccessHeader } from '@opencode-manager/shared/schemas'

export const CLOUDFLARE_CLIENT_ID = 'client-id-9f4c2b7e1a5d'
export const CLOUDFLARE_CLIENT_SECRET = 'client-secret-4d8e2f7b1c90'

export const CLOUDFLARE_HEADERS: RemoteAccessHeader[] = [
  { name: 'CF-Access-Client-Id', value: CLOUDFLARE_CLIENT_ID },
  { name: 'CF-Access-Client-Secret', value: CLOUDFLARE_CLIENT_SECRET },
]

export const CLOUDFLARE_SECRET_VALUES = [CLOUDFLARE_CLIENT_ID, CLOUDFLARE_CLIENT_SECRET]
