import { beforeAll, afterAll, vi } from 'vitest'

vi.mock('bun', () => {
  const createMockReadableStream = () => ({
    getReader: () => ({
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    }),
  })

  const createMockWritableStream = () => ({
    write: vi.fn(),
    flush: vi.fn(),
  })

  return {
    spawn: vi.fn(() => ({
      stdin: createMockWritableStream(),
      stdout: createMockReadableStream(),
      stderr: createMockReadableStream(),
      pid: 12345,
      kill: vi.fn(),
      exited: Promise.resolve(0),
    })),
    Subprocess: class {},
  }
})

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PORT', '3001')
  vi.stubEnv('DATABASE_PATH', ':memory:')
})

afterAll(() => {
  vi.unstubAllEnvs()
})
