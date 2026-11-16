import type { SessionSandboxResources } from '@opencode-manager/shared/schemas'

export type StubSandboxRuntime = {
  getCheckoutResources: (
    directory: string,
  ) => Promise<{ effective: SessionSandboxResources; running: SessionSandboxResources | null }>
  restartCheckoutSandbox: (directory: string) => Promise<void>
}

export function createStubSandboxRuntime(): StubSandboxRuntime {
  return {
    getCheckoutResources: async () => ({
      effective: { cpus: 2, memoryMib: 2048 },
      running: null,
    }),
    restartCheckoutSandbox: async () => undefined,
  }
}
