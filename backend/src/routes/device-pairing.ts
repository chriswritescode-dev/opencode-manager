import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { ENV, getTrustedOrigins } from '@opencode-manager/shared/config/env'
import { CreateDevicePairingLinksRequestSchema } from '@opencode-manager/shared/schemas'
import {
  buildDevicePairingLinks,
  normalizeDevicePairingOrigin,
  resolveAppLinkPolicy,
  resolveDevicePairingAvailability,
} from '../services/device-pairing-links'
import type { RemoteAccessHeadersService } from '../services/remote-access-headers'
import { logger } from '../utils/logger'
import { parseJsonBody } from '../utils/route-helpers'

const LINKS_FAILED_MESSAGE = 'Failed to create device pairing links'
const MISSING_ORIGIN_QUERY_MESSAGE =
  'Add an origin query parameter, for example ?origin=https://manager.example.com.'
const INVALID_ORIGIN_QUERY_MESSAGE =
  'The origin query parameter must be an absolute http or https URL.'

const noStore: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
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

  app.use('/links', noStore)
  app.use('/availability', noStore)

  app.get('/availability', (c) => {
    const requestedOrigin = c.req.query('origin')
    if (!requestedOrigin) return c.json({ error: MISSING_ORIGIN_QUERY_MESSAGE }, 400)

    const origin = normalizeDevicePairingOrigin(requestedOrigin)
    if (!origin) return c.json({ error: INVALID_ORIGIN_QUERY_MESSAGE }, 400)

    return c.json(
      resolveDevicePairingAvailability(origin, {
        trustedOrigins: resolveTrustedOrigins(),
        isDevelopment: isDevelopment(),
      }),
    )
  })

  app.post('/links', async (c) => {
    const body = await parseJsonBody(c, CreateDevicePairingLinksRequestSchema, { allowEmpty: true })
    if (!body.ok) return body.response

    const origin = c.req.header('origin')
    const availability = resolveDevicePairingAvailability(origin, {
      trustedOrigins: resolveTrustedOrigins(),
      isDevelopment: isDevelopment(),
    })
    if (!origin || !availability.available) {
      return c.json({ error: availability.message, code: availability.reason }, 400)
    }

    try {
      const originUrl = new URL(origin)
      const policy = resolveAppLinkPolicy(originUrl, {
        allowPrivateNetworkHttp: deps.readAllowPrivateNetworkHttp(),
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
