import { vi } from 'vitest'
import type { OpenCodeClient } from '../../src/services/opencode/client'

export interface FakePendingPermissionRequest {
  id: string
  sessionID: string
}

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

export interface FakeSessionPermissionClient extends OpenCodeClient {
  replyPermission: ReturnType<typeof vi.fn>
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
    (async (sessionID: string) => {
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

  return {
    replyPermission,
    api: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => getSession(sessionID),
        active: async () => Object.fromEntries(
          (options.activeSessions ?? []).map(sessionID => [sessionID, { type: 'running' as const }]),
        ),
      },
      permission: {
        request: {
          list: async (input?: { location?: { directory?: string } }) => {
            const directory = input?.location?.directory ?? ''
            return {
              location: { directory },
              data: await listRequests(directory),
            }
          },
        },
        reply: replyPermission,
      },
    },
    forwardRaw: async () => new Response(),
  } as unknown as FakeSessionPermissionClient
}
