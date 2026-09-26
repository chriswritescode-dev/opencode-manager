import { vi } from 'vitest'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'

export function createStubOpenCodeClient(overrides: Partial<OpenCodeClient> = {}): OpenCodeClient {
  return {
    api: {
      server: {
        info: vi.fn(async () => ({ version: '2.0.15', pid: 1234, urls: [], paths: { tmp: '/tmp' } })),
      },
      location: {
        reload: vi.fn(async () => undefined),
        get: vi.fn(async () => ({
          directory: '/tmp/repo',
          project: { id: 'commit-A', directory: '/tmp/repo', canonical: '/tmp/repo' },
        })),
      },
      worktree: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ directory: '/tmp/wrk-test' })),
        remove: vi.fn(async () => undefined),
      },
      mcp: {
        list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
        add: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        connect: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
      },
      integration: {
        list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
        get: vi.fn(async () => ({
          location: { directory: '/tmp/repo' },
          data: { id: 'stub-integration', name: 'Stub', methods: [], connections: [] },
        })),
        connect: {
          key: vi.fn(async () => undefined),
        },
        oauth: {
          connect: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: {
              attemptID: 'con_stub',
              url: 'https://example.com/authorize',
              instructions: 'Authorize in your browser',
              mode: 'auto' as const,
              time: { created: 0, expires: 0 },
            },
          })),
          status: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: { status: 'pending' as const, time: { created: 0, expires: 0 } },
          })),
          complete: vi.fn(async () => undefined),
          cancel: vi.fn(async () => undefined),
        },
      },
      credential: {
        remove: vi.fn(async () => undefined),
      },
      skill: {
        list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
      },
    } as unknown as OpenCodeApi,
    forwardRaw: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    ...overrides,
  } as OpenCodeClient
}
