import { Hono } from 'hono'
import { ENV, getTrustedOrigins, isTrustedOrigin } from '@opencode-manager/shared/config/env'
import { CreateDevicePairingLinksRequestSchema } from '@opencode-manager/shared/schemas'
import { buildDevicePairingLinks, resolveAppLinkPolicy } from '../services/device-pairing-links'
import type { RemoteAccessHeadersService } from '../services/remote-access-headers'
import { logger } from '../utils/logger'
import { parseJsonBody } from '../utils/route-helpers'

const MISSING_ORIGIN_MESSAGE =
  'The request had no Origin header. Open the Manager at an address listed in AUTH_TRUSTED_ORIGINS to pair a device.'
const LINKS_FAILED_MESSAGE = 'Failed to create device pairing links'

function untrustedOriginMessage(origin: string | undefined): string {
  if (!origin) return MISSING_ORIGIN_MESSAGE
  return `This address (${origin}) is not in AUTH_TRUSTED_ORIGINS. Add it and restart the Manager to pair a device.`
}

interface DevicePairingRouteDeps {
  mintPairingCode(headers: Headers): Promise<{ code: string; expiresAt: Date | string }>
  remoteAccessHeaders: RemoteAccessHeadersService
  readAllowPrivateNetworkHttp(): boolean
  resolveTrustedOrigins?: () => string[]
  isDevelopment?: () => boolean
}

/** Creates the routes that mint device pairing links for the Manager origin. */
export function createDevicePairingRoutes(deps: DevicePairingRouteDeps) {
  const app = new Hono()
  const resolveTrustedOrigins = deps.resolveTrustedOrigins ?? getTrustedOrigins
  const isDevelopment = deps.isDevelopment ?? (() => ENV.SERVER.NODE_ENV === 'development')

  app.use('/links', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.post('/links', async (c) => {
    const body = await parseJsonBody(c, CreateDevicePairingLinksRequestSchema, { allowEmpty: true })
    if (!body.ok) return body.response

    const origin = c.req.header('origin')
    if (!origin || !isTrustedOrigin(origin, { requireOrigin: true }, resolveTrustedOrigins())) {
      return c.json({ error: untrustedOriginMessage(origin) }, 400)
    }

    try {
      const originUrl = new URL(origin)
      const policy = resolveAppLinkPolicy(originUrl, {
        allowPrivateNetworkHttp: deps.readAllowPrivateNetworkHttp(),
        isDevelopment: isDevelopment(),
      })
      const stored = deps.remoteAccessHeaders.read()
      const minted = await deps.mintPairingCode(c.req.raw.headers)

      return c.json(
        buildDevicePairingLinks({
          origin: originUrl,
          name: body.data.name ?? originUrl.hostname,
          code: minted.code,
          expiresAt: new Date(minted.expiresAt),
          headers: stored.headers,
          headersUnreadable: stored.unreadable,
          policy,
        }),
      )
    } catch (error) {
      logger.error(LINKS_FAILED_MESSAGE, error instanceof Error ? error.message : 'unknown')
      return c.json({ error: LINKS_FAILED_MESSAGE }, 500)
    }
  })

  return app
}
