import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, E2E_ROOT, REPORT_DIR, REPO_ROOT, STORAGE_STATE, TEST_RESULTS_DIR, createServerEnv } from './env'

export default defineConfig({
  testDir: E2E_ROOT,
  outputDir: TEST_RESULTS_DIR,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: REPORT_DIR }],
    ['./cleanup-reporter.ts'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'bash e2e/server.sh',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    env: createServerEnv(),
  },
})
