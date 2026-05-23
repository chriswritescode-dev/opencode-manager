import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/services/assistant-mode.test.ts',
      'test/services/internal-token.test.ts',
      'test/auth/internal-token-middleware.test.ts',
      'test/routes/internal-schedules.test.ts',
      'test/routes/internal-notifications.test.ts',
      'test/routes/internal-settings.test.ts',
      'test/routes/internal-repos.test.ts',
      'src/db/model-state.test.ts',
      'src/routes/providers.test.ts',
    ],
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
      'bun:sqlite': path.resolve(__dirname, './test/mocks/bun-sqlite.ts'),
    },
  },
})
