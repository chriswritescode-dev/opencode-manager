import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import path from 'path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts']
  },
  resolve: {
    alias: {
      'bun:sqlite': path.join(rootDir, 'test', 'bun-sqlite.ts'),
    },
  },
})
