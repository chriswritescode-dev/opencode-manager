import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_PATH: ':memory:',
      AUTH_SECRET: 'test-secret-for-encryption',
      WORKSPACE_PATH: '/tmp/test-workspace',
    },
  },
  resolve: {
    alias: {
      'bun:sqlite': './test/mocks/bun-sqlite.ts',
    },
  },
})
