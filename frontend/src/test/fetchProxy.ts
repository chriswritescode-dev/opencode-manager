export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const nativeFetch: FetchImplementation = globalThis.fetch.bind(globalThis)
let activeFetch: FetchImplementation = nativeFetch

export function installFetchProxy(): void {
  globalThis.fetch = (input, init) => activeFetch(input, init)
}

export function setActiveFetch(implementation: FetchImplementation | null): void {
  activeFetch = implementation ?? nativeFetch
}
