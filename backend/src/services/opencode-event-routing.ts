import { EventSource } from 'eventsource'
import { openCodeLocation, sessionIDFromEvent, type OpenCodeApi, type V2Event } from '@opencode-manager/shared/opencode'
import { logger } from '../utils/logger'

const MULTILINE_PATTERN = /[\r\n]/

export type ReplayEventType = 'permission.asked' | 'form.created' | 'session.status'

export type ReplayEventBuilder = (type: ReplayEventType, directory: string, data: unknown) => V2Event

export interface RoutedOpenCodeEvent {
  event: V2Event
  payloadJson: string
  directory: string | undefined
  resolvedDirectory: string | undefined
}

export interface PendingReplayRequest {
  api: OpenCodeApi
  directory: string
  buildEvent: ReplayEventBuilder
  logScope: string
  logTarget: string
}

export interface PendingReplayEvents {
  permissions: V2Event[]
  forms: V2Event[]
}

export interface SessionStatusReplayPlan {
  idle: Array<{ sessionID: string; directory: string }>
  busy: string[]
}

export type EventSourceInit = ConstructorParameters<typeof EventSource>[1]

/**
 * Partitions tracked sessions into those that must be replayed as idle and the
 * active sessions that must be replayed as busy.
 */
export function planSessionStatusReplay(
  active: Record<string, unknown>,
  tracked: ReadonlyMap<string, string>,
): SessionStatusReplayPlan {
  const busy = Object.keys(active ?? {})
  const busySet = new Set(busy)
  const idle: Array<{ sessionID: string; directory: string }> = []
  for (const [sessionID, directory] of tracked) {
    if (!busySet.has(sessionID)) idle.push({ sessionID, directory })
  }
  return { idle, busy }
}

export function createReplayEventBuilder(idPrefix: string): ReplayEventBuilder {
  let count = 0
  return (type, directory, data) => {
    count += 1
    return {
      id: `${idPrefix}${count}`,
      created: Date.now(),
      type,
      location: { directory },
      data,
    } as V2Event
  }
}

export function parseOpenCodeEvent(data: string, sessionDirectories: Map<string, string>): RoutedOpenCodeEvent | null {
  let event: V2Event
  try {
    event = JSON.parse(data) as V2Event
  } catch {
    return null
  }

  if (!event?.type) return null

  const payloadJson = MULTILINE_PATTERN.test(data) ? JSON.stringify(event) : data
  const directory = event.location?.directory
  const sessionID = sessionIDFromEvent(event)
  const forkParentId = event.type === 'session.forked' ? event.data.parentID : undefined
  const inheritedDirectory = forkParentId ? sessionDirectories.get(forkParentId) : undefined
  const rememberedDirectory = directory ?? inheritedDirectory
  const resolvedDirectory = rememberedDirectory ?? (sessionID ? sessionDirectories.get(sessionID) : undefined)

  if (sessionID && event.type === 'session.deleted') {
    sessionDirectories.delete(sessionID)
  } else if (sessionID && rememberedDirectory) {
    sessionDirectories.set(sessionID, rememberedDirectory)
  }

  return { event, payloadJson, directory, resolvedDirectory }
}

export async function collectPendingReplayEvents(request: PendingReplayRequest): Promise<PendingReplayEvents> {
  const { api, directory, buildEvent, logScope, logTarget } = request
  const [permissionsResult, formsResult] = await Promise.allSettled([
    api.permission.request.list(openCodeLocation(directory)),
    api.form.list(openCodeLocation(directory)),
  ])

  const permissions: V2Event[] = []
  if (permissionsResult.status === 'rejected') {
    logger.warn(`${logScope}: failed to fetch pending permissions for ${logTarget}: ${String(permissionsResult.reason)}`)
  } else {
    for (const permission of permissionsResult.value.data) {
      permissions.push(buildEvent('permission.asked', directory, permission))
    }
  }

  const forms: V2Event[] = []
  if (formsResult.status === 'rejected') {
    logger.warn(`${logScope}: failed to fetch pending forms for ${logTarget}: ${String(formsResult.reason)}`)
  } else {
    for (const form of formsResult.value.data) {
      forms.push(buildEvent('form.created', directory, { form }))
    }
  }

  return { permissions, forms }
}

export function createAuthorizedEventSourceInit(authorization: string | null): EventSourceInit {
  if (!authorization) return undefined
  return {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: authorization,
        },
      }),
  }
}

export function nextBackoffDelay(currentDelayMs: number, maxDelayMs: number): number {
  return Math.min(currentDelayMs * 2, maxDelayMs)
}
