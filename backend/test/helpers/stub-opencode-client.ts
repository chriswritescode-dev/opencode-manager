import { vi } from 'vitest'
import type { OpenCodeClient } from '../../src/services/opencode/client'

export function createStubOpenCodeClient(overrides: Partial<OpenCodeClient> = {}): OpenCodeClient {
  return {
    forward: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    forwardRaw: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    getJson: vi.fn(async () => ({}) as unknown),
    postJson: vi.fn(async () => ({}) as unknown),
    setProviderAuth: vi.fn(async () => true),
    deleteProviderAuth: vi.fn(async () => true),
    startMcpAuth: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    authenticateMcp: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    ...overrides,
  } as OpenCodeClient
}
