import { vi } from 'vitest'
import type { RepoEnvResolver } from '../../src/services/repo-env'

export function createStubRepoEnvService(env: Record<string, string> = {}): RepoEnvResolver {
  return {
    resolveForDirectory: vi.fn(async () => ({ env, maskValues: [] })),
  }
}
