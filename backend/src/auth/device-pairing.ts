import { createHash, randomBytes } from 'node:crypto'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import {
  DEVICE_PAIRING_CODE_TTL_SECONDS,
  DEVICE_PAIRING_ERROR_CODES,
  PAIRING_CODE_INVALID_MESSAGE,
  RedeemDevicePairingCodeRequestSchema,
  type PairedDevice,
} from '@opencode-manager/shared/schemas'
import { logger } from '../utils/logger'

const PAIRING_IDENTIFIER_PREFIX = 'device-pairing:'
const REDEEM_PATH = '/device-pairing/redeem'
const DEVICES_PATH = '/device-pairing/devices'
const REVOKE_PATH = '/device-pairing/devices/revoke'

type SessionRecord = {
  id: string
  createdAt: Date
  updatedAt: Date
  ipAddress?: string | null
  userAgent?: string | null
  deviceName?: string | null
}

function toPairedDevice(session: SessionRecord, currentSessionId: string): PairedDevice {
  return {
    id: session.id,
    deviceName: session.deviceName ?? null,
    userAgent: session.userAgent || null,
    ipAddress: session.ipAddress || null,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    isCurrent: session.id === currentSessionId,
  }
}

function pairingIdentifier(code: string): string {
  return `${PAIRING_IDENTIFIER_PREFIX}${createHash('sha256').update(code).digest('base64url')}`
}

function invalidPairingCodeError(): APIError {
  return new APIError('BAD_REQUEST', {
    message: PAIRING_CODE_INVALID_MESSAGE,
    code: DEVICE_PAIRING_ERROR_CODES.PAIRING_CODE_INVALID,
  })
}

export interface DevicePairingOptions {
  onDeviceRevoked?: (sessionId: string) => void
}

/** Adds pairing code, paired device, and revoke endpoints to Better Auth. */
export function devicePairing(options: DevicePairingOptions = {}) {
  const { onDeviceRevoked } = options
  return {
    id: 'device-pairing',
    schema: {
      session: {
        fields: {
          deviceName: { type: 'string', required: false, input: false },
        },
      },
    },
    endpoints: {
      createDevicePairingCode: createAuthEndpoint.serverOnly(
        { method: 'POST', use: [sessionMiddleware], requireHeaders: true },
        async (ctx) => {
          const code = randomBytes(32).toString('base64url')
          const expiresAt = new Date(Date.now() + DEVICE_PAIRING_CODE_TTL_SECONDS * 1000)

          await ctx.context.adapter.deleteMany({
            model: 'verification',
            where: [
              { field: 'identifier', value: PAIRING_IDENTIFIER_PREFIX, operator: 'starts_with' },
              { field: 'expiresAt', value: new Date(), operator: 'lt' },
            ],
          })
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: pairingIdentifier(code),
            value: ctx.context.session.user.id,
            expiresAt,
          })

          return ctx.json({ code, expiresAt })
        },
      ),
      redeemDevicePairingCode: createAuthEndpoint(
        REDEEM_PATH,
        {
          method: 'POST',
          body: RedeemDevicePairingCodeRequestSchema,
          metadata: { noStore: true },
        },
        async (ctx) => {
          const { code, deviceName } = ctx.body
          const record = await ctx.context.internalAdapter.consumeVerificationValue(pairingIdentifier(code))
          if (!record) throw invalidPairingCodeError()

          const user = await ctx.context.internalAdapter.findUserById(record.value)
          if (!user) throw invalidPairingCodeError()

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            deviceName ? { deviceName } : undefined,
          )
          await setSessionCookie(ctx, { session, user })

          return ctx.json({ user: { id: user.id, name: user.name, email: user.email } })
        },
      ),
      listPairedDevices: createAuthEndpoint(
        DEVICES_PATH,
        { method: 'GET', use: [sessionMiddleware], requireHeaders: true },
        async (ctx) => {
          const currentSessionId = ctx.context.session.session.id
          const sessions = await ctx.context.internalAdapter.listSessions(ctx.context.session.user.id, {
            onlyActiveSessions: true,
          })
          const devices = sessions
            .map((session) => toPairedDevice(session, currentSessionId))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

          return ctx.json({ devices })
        },
      ),
      revokePairedDevice: createAuthEndpoint(
        REVOKE_PATH,
        {
          method: 'POST',
          body: z.object({ id: z.string().min(1) }),
          use: [sessionMiddleware],
          requireHeaders: true,
        },
        async (ctx) => {
          const sessions = await ctx.context.internalAdapter.listSessions(ctx.context.session.user.id, {
            onlyActiveSessions: true,
          })
          const target = sessions.find((session) => session.id === ctx.body.id)
          if (!target) {
            throw new APIError('NOT_FOUND', {
              message: 'This device is no longer paired',
              code: DEVICE_PAIRING_ERROR_CODES.DEVICE_NOT_FOUND,
            })
          }
          if (target.id === ctx.context.session.session.id) {
            throw new APIError('BAD_REQUEST', {
              message: 'The current device cannot be revoked',
              code: DEVICE_PAIRING_ERROR_CODES.CANNOT_REVOKE_CURRENT_SESSION,
            })
          }

          await ctx.context.internalAdapter.deleteSession(target.token)
          if (onDeviceRevoked) {
            try {
              onDeviceRevoked(target.id)
            } catch (error) {
              logger.error(`Failed to delete push subscriptions for revoked session ${target.id}`, error)
            }
          }
          return ctx.json({ status: true })
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
