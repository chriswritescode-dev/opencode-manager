import { beforeAll, afterAll, vi } from 'vitest'

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PORT', '3001')
  vi.stubEnv('DATABASE_PATH', ':memory:')
  vi.stubEnv('AUTH_SECRET', 'test-secret-for-encryption')
  vi.stubEnv('NODE_NO_WARNINGS', '1')
})

afterAll(() => {
  vi.unstubAllEnvs()
})
