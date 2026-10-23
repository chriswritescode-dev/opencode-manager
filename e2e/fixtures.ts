import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect, request as playwrightRequest, type Page } from '@playwright/test'
import { BASE_URL, E2E_TMP, STORAGE_STATE } from './env'

export interface RepoFixture {
  id: number
  name: string
  fullPath: string
  sessionId: string
}

interface WorkerFixtures {
  repo: RepoFixture
}

async function createGitFixtureRepo(directory: string): Promise<void> {
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'README.md'), '# e2e fixture repository\n')

  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  git('-c', 'init.defaultBranch=main', 'init', '-q')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'add', '-A')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '-m', 'initial commit')
}

export const test = base.extend<{ page: Page }, WorkerFixtures>({
  page: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`)
    })
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const url = message.location().url
      const text = `${message.text()}${url ? ` (${url})` : ''}`
      errors.push(`console.error: ${text}`)
    })

    await use(page)

    expect(errors, `Unexpected browser errors:\n${errors.join('\n')}`).toEqual([])
  },

  repo: [
    async ({}, use, workerInfo) => {
      const api = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        storageState: STORAGE_STATE,
      })

      try {
        const directory = path.join(E2E_TMP, `e2e-fixture-repo-${workerInfo.workerIndex}`)
        await createGitFixtureRepo(directory)

        const repoResponse = await api.post('/api/repos', { data: { localPath: directory } })
        if (!repoResponse.ok()) {
          throw new Error(`Failed to register e2e repo: ${repoResponse.status()} ${await repoResponse.text()}`)
        }
        const repo = await repoResponse.json()

        const sessionResponse = await api.post('/api/opencode/api/session', {
          data: { location: { directory: repo.fullPath } },
        })
        if (!sessionResponse.ok()) {
          throw new Error(`Failed to create e2e session: ${sessionResponse.status()} ${await sessionResponse.text()}`)
        }
        const session = await sessionResponse.json()

        await use({
          id: repo.id,
          name: path.basename(repo.localPath),
          fullPath: repo.fullPath,
          sessionId: session.data.id,
        })
      } finally {
        await api.dispose()
      }
    },
    { scope: 'worker' },
  ],
})

export { expect }
