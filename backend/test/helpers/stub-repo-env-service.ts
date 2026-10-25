import { vi } from 'vitest'
import type { RepoEnvService } from '../../src/services/repo-env'

/**
 * Creates a RepoEnvService stub that resolves a fixed environment.
 */
export function createStubRepoEnvService(env: Record<string, string> = {}): RepoEnvService {
  return {
    resolveForDirectory: vi.fn(async () => ({ env, maskValues: [] })),
  } as unknown as RepoEnvService
}
