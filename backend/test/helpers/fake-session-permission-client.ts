import { vi } from 'vitest'
import type { OpenCodeApi, PermissionRequest } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createStubOpenCodeApi, sessionInfo } from './stub-opencode-client'

export type FakePendingPermissionRequest = Pick<PermissionRequest, 'id' | 'sessionID'>

export interface FakeSessionInfo {
  parentID?: string | null
  location?: { directory: string }
}

export interface FakeSessionPermissionClientOptions {
  parents?: Record<string, string | null>
  directories?: Record<string, string>
  activeSessions?: string[]
  failSessionGet?: boolean
  pendingRequests?: Record<string, FakePendingPermissionRequest[]>
  getSession?: (sessionID: string) => Promise<FakeSessionInfo>
  listRequests?: (directory: string) => Promise<FakePendingPermissionRequest[]>
}

type SessionActiveState = Awaited<ReturnType<OpenCodeApi['session']['active']>>

export interface FakeSessionPermissionClient extends OpenCodeClient {
  replyPermission: ReturnType<typeof vi.fn>
}

export function permissionRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'per_stub',
    sessionID: 'ses_stub',
    action: 'bash',
    resources: [],
    ...overrides,
  }
}

export function toPermissionRequest(request: FakePendingPermissionRequest): PermissionRequest {
  return permissionRequest({ id: request.id, sessionID: request.sessionID })
}

export function createFakeSessionPermissionClient(
  options: FakeSessionPermissionClientOptions = {},
): FakeSessionPermissionClient {
  const parents = options.parents ?? {}
  const directories = options.directories ?? {}
  const pendingRequests = options.pendingRequests ?? {}
  const replyPermission = vi.fn(async () => {})

  const getSession =
    options.getSession ??
    (async (sessionID: string): Promise<FakeSessionInfo> => {
      if (options.failSessionGet) {
        throw new Error('upstream unavailable')
      }
      return {
        parentID: parents[sessionID] ?? undefined,
        location: { directory: directories[sessionID] ?? '' },
      }
    })

  const listRequests =
    options.listRequests ??
    (async (directory: string) => pendingRequests[directory] ?? [])

  const api = createStubOpenCodeApi()
  api.session.get = vi.fn(async ({ sessionID }: { sessionID: string }) => {
    const session = await getSession(sessionID)
    const info = sessionInfo({ id: sessionID, parentID: session.parentID ?? undefined })
    if (session.location) {
      info.location = session.location
    }
    return info
  })
  api.session.active = vi.fn(async () => {
    const active: SessionActiveState = {}
    for (const sessionID of options.activeSessions ?? []) {
      active[sessionID] = { type: 'running' }
    }
    return active
  })
  api.permission.request.list = vi.fn(async (input?: { location?: { directory?: string } }) => {
    const directory = input?.location?.directory ?? ''
    return {
      location: { directory },
      data: (await listRequests(directory)).map(toPermissionRequest),
    }
  })
  api.permission.reply = replyPermission

  return {
    replyPermission,
    api,
    forwardRaw: async () => new Response(),
  }
}
