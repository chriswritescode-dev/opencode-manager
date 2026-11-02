import {
  openCodeLocation,
  sessionIDFromEvent,
  type FormInfo,
  type OpenCodeApi,
  type V2Event,
} from '@opencode-manager/shared/opencode'
import { logger } from '../utils/logger'

type PermissionAskedEvent = Extract<V2Event, { type: 'permission.asked' }>
type FormCreatedEvent = Extract<V2Event, { type: 'form.created' }>
type SessionStatusEvent = Extract<V2Event, { type: 'session.status' }>

export type ReplayEvent = PermissionAskedEvent | FormCreatedEvent | SessionStatusEvent

type ReplayEventArguments =
  | [type: PermissionAskedEvent['type'], directory: string, data: PermissionAskedEvent['data']]
  | [type: FormCreatedEvent['type'], directory: string, data: { form: FormInfo }]
  | [type: SessionStatusEvent['type'], directory: string, data: SessionStatusEvent['data']]

export type ReplayEventBuilder = (...args: ReplayEventArguments) => ReplayEvent

export interface RoutedOpenCodeEvent {
  event: V2Event
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

/**
 * Records the activity state an event implies for its session, so that directory-scoped work can be
 * limited to the sessions that are actually running.
 *
 * @param busySessions Sessions currently running on the server, updated in place.
 * @param event Event observed on the server stream.
 */
export function applySessionActivity(busySessions: Set<string>, event: V2Event): void {
  switch (event.type) {
    case 'session.status': {
      const { sessionID, status } = event.data
      if (status.type === 'idle') busySessions.delete(sessionID)
      else busySessions.add(sessionID)
      return
    }
    case 'session.execution.started':
      busySessions.add(event.data.sessionID)
      return
    case 'session.idle':
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
    case 'session.deleted':
      busySessions.delete(event.data.sessionID)
  }
}

export function createReplayEventBuilder(idPrefix: string): ReplayEventBuilder {
  let count = 0
  return (...args) => {
    count += 1
    const base = { id: `${idPrefix}${count}`, created: Date.now() }
    switch (args[0]) {
      case 'permission.asked':
        return { ...base, type: args[0], location: { directory: args[1] }, data: args[2] }
      case 'form.created':
        return { ...base, type: args[0], location: { directory: args[1] }, data: args[2] as FormCreatedEvent['data'] }
      case 'session.status':
        return { ...base, type: args[0], location: { directory: args[1] }, data: args[2] }
    }
  }
}

/**
 * Resolves the directory a parsed event belongs to and updates the remembered session directories.
 *
 * @param event Parsed event received from an OpenCode server.
 * @param sessionDirectories Session directories remembered across events, updated in place.
 * @returns The event with its resolved directories.
 */
export function routeOpenCodeEvent(
  event: V2Event,
  sessionDirectories: Map<string, string>,
): RoutedOpenCodeEvent {
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

  return { event, directory, resolvedDirectory }
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
