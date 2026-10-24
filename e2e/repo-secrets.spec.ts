import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { request as playwrightRequest, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { createMockRepo, createSession, startMockProvider, type MockProvider } from './mockProvider'
import { BASE_URL, STORAGE_STATE } from './env'

const SECRET_NAME = 'E2E_SECRET_TOKEN'
const VARIABLE_NAME = 'E2E_BASE_URL'
const SECRET_VALUE = `e2e-secret-${randomBytes(12).toString('hex')}`
const VARIABLE_VALUE = 'https://e2e.example.test'
const PRINT_ENV = `printf 'secret=[%s] var=[%s]\\n' "$${SECRET_NAME}" "$${VARIABLE_NAME}"`
const AGENT_COMMAND = `printf 'token=%s\\n' "$${SECRET_NAME}"`

interface SecretsRepo {
  id: number
  fullPath: string
}

let provider: MockProvider
let secretsRepo: SecretsRepo

function locationQuery(directory: string): string {
  return new URLSearchParams({ 'location[directory]': directory }).toString()
}

async function requireOk(response: APIResponse, label: string): Promise<unknown> {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`)
  }
  return response.status() === 204 ? null : response.json()
}

async function runShell(request: APIRequestContext, directory: string, command: string): Promise<string> {
  const sessionID = await createSession(request, directory)
  const started = await requireOk(
    await request.post(`/api/opencode/api/shell?${locationQuery(directory)}`, {
      data: { command, timeout: 30_000, metadata: { sessionID } },
    }),
    'start shell',
  )
  const shellID = (started as { data: { id: string } }).data.id
  try {
    let output = ''
    await expect
      .poll(async () => {
        const read = await requireOk(
          await request.get(`/api/opencode/api/shell/${shellID}/output?${locationQuery(directory)}&cursor=0&limit=65536`),
          'read shell output',
        )
        output = JSON.stringify(read)
        return output.includes('secret=[')
      })
      .toBe(true)
    return output
  } finally {
    await request.delete(`/api/opencode/api/shell/${shellID}?${locationQuery(directory)}`)
  }
}

async function readTerminalOutput(page: Page, repoId: number, ptyID: string, command: string, expected: string): Promise<string> {
  return page.evaluate(
    async ({ url, input, needle }) => {
      const socket = new WebSocket(url)
      socket.binaryType = 'arraybuffer'
      const decoder = new TextDecoder()
      let text = ''
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.close()
          reject(new Error(`terminal output did not contain ${needle}: ${text}`))
        }, 20_000)
        socket.onopen = () => socket.send(input)
        socket.onerror = () => reject(new Error('terminal socket failed'))
        socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
          text += typeof event.data === 'string' ? event.data : decoder.decode(event.data, { stream: true })
          if (!text.includes(needle)) return
          clearTimeout(timer)
          socket.close()
          resolve(text)
        }
      })
    },
    {
      url: `${BASE_URL.replace(/^http/, 'ws')}/api/repos/${repoId}/terminals/${encodeURIComponent(ptyID)}/connect`,
      input: `${command}\r`,
      needle: expected,
    },
  )
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  provider = await startMockProvider()
  provider.setResponder((request) => {
    const lastRole = request.messages?.at(-1)?.role
    const wantsShell = Array.isArray(request.tools) && request.tools.length > 0 && lastRole !== 'tool'
    if (!wantsShell) {
      return { content: 'Done.' }
    }
    return { toolCall: { name: 'shell', arguments: { command: AGENT_COMMAND, description: 'Print the token' } } }
  })

  const repo = await createMockRepo('e2e-secrets-repo', provider.port, {
    beforeCommit: (directory) => {
      fs.mkdirSync(path.join(directory, '.ocm'), { recursive: true })
      fs.writeFileSync(
        path.join(directory, '.ocm', 'project.json'),
        JSON.stringify({
          version: 1,
          environment: 'e2e',
          env: {
            [SECRET_NAME]: `\${{ secrets.${SECRET_NAME} }}`,
            [VARIABLE_NAME]: `\${{ vars.${VARIABLE_NAME} }}`,
          },
        }),
      )
    },
  })
  secretsRepo = { id: repo.id, fullPath: repo.fullPath }

  const api = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE })
  try {
    await requireOk(
      await api.put(`/api/repos/${repo.id}/secrets/${SECRET_NAME}`, { data: { value: SECRET_VALUE, environment: 'e2e' } }),
      'store secret',
    )
    await requireOk(
      await api.put(`/api/repos/${repo.id}/variables/${VARIABLE_NAME}`, { data: { value: VARIABLE_VALUE } }),
      'store variable',
    )
  } finally {
    await api.dispose()
  }
})

test.afterAll(async () => {
  await provider.close()
})

test.describe('repository secrets', () => {
  test('injects mapped values into agent shells only once the project file is trusted', async ({ request }) => {
    const config = (await requireOk(
      await request.get(`/api/repos/${secretsRepo.id}/project-config`),
      'read project config',
    )) as { repoFile: { trusted: boolean; hash: string | null; executable: { env?: Record<string, string> } | null } }
    expect(config.repoFile.trusted).toBe(false)
    expect(config.repoFile.executable?.env).toEqual({
      [SECRET_NAME]: `\${{ secrets.${SECRET_NAME} }}`,
      [VARIABLE_NAME]: `\${{ vars.${VARIABLE_NAME} }}`,
    })

    const untrusted = await runShell(request, secretsRepo.fullPath, PRINT_ENV)
    expect(untrusted).toContain('secret=[] var=[]')

    expect(config.repoFile.hash).not.toBeNull()
    await requireOk(
      await request.post(`/api/repos/${secretsRepo.id}/project-config/trust`, { data: { hash: config.repoFile.hash } }),
      'trust project file',
    )

    await expect
      .poll(async () => runShell(request, secretsRepo.fullPath, PRINT_ENV), { timeout: 30_000, intervals: [1_000, 2_000] })
      .toContain(`secret=[${SECRET_VALUE}] var=[${VARIABLE_VALUE}]`)
  })

  test('injects mapped values into repo terminals', async ({ page, request }) => {
    await page.goto(`/repos/${secretsRepo.id}`)
    const terminal = (await requireOk(
      await request.post(`/api/repos/${secretsRepo.id}/terminals`, { data: { title: 'secrets' } }),
      'create terminal',
    )) as { id: string }
    try {
      const output = await readTerminalOutput(
        page,
        secretsRepo.id,
        terminal.id,
        PRINT_ENV,
        `secret=[${SECRET_VALUE}] var=[${VARIABLE_VALUE}]`,
      )
      expect(output).toContain(`secret=[${SECRET_VALUE}] var=[${VARIABLE_VALUE}]`)
    } finally {
      await request.delete(`/api/repos/${secretsRepo.id}/terminals/${encodeURIComponent(terminal.id)}`)
    }
  })

  test('masks secret values in recorded agent tool output', async ({ request }) => {
    const sessionId = await createSession(request, secretsRepo.fullPath)
    await requireOk(
      await request.post(`/api/opencode/api/session/${sessionId}/prompt`, { data: { text: 'print the token' } }),
      'prompt session',
    )

    let transcript = ''
    await expect
      .poll(
        async () => {
          const messages = await requireOk(
            await request.get(`/api/opencode/api/session/${sessionId}/message`),
            'list messages',
          )
          transcript = JSON.stringify(messages)
          return transcript.includes('token=***')
        },
        { timeout: 60_000 },
      )
      .toBe(true)
    expect(transcript).not.toContain(SECRET_VALUE)
  })

  test('lists secrets by name without revealing their values', async ({ page }) => {
    await page.goto(`/repos/${secretsRepo.id}`)
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Secrets' }).click()
    const panel = page.getByRole('complementary', { name: 'Secrets' })
    await expect(panel.getByText(SECRET_NAME, { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: `Update ${SECRET_NAME}` })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(SECRET_VALUE)
  })
})
