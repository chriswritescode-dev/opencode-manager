import { vi, type Mock } from 'vitest'

export interface FetchStubHandler {
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response>
}

export type FetchStub = Mock<FetchStubHandler> & { preconnect: typeof fetch.preconnect }

export function createFetchStub(handler: FetchStubHandler): FetchStub {
  return Object.assign(vi.fn(handler), { preconnect: fetch.preconnect })
}
