import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_PATH: ':memory:',
      AUTH_SECRET: 'test-secret-for-encryption',
      WORKSPACE_PATH: '/test/workspace',
    },
  },
})
