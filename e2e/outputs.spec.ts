import type { APIRequestContext } from '@playwright/test'
import { test, expect } from './fixtures'
import { createMockRepo, startMockProvider, type MockChatRequest, type MockProvider, type MockRepo, type MockTurn } from './mockProvider'

const MOCK_PROVIDER_PORT = 5567
const DEFINITION_ID = 'e2e-summary'
const DEFINITION_LABEL = 'E2E Summary'
const PUBLISHED_TITLE = 'Hello outputs'

const TEMPLATE_HTML = `<!doctype html>
<html>
<body>
<div id="title">waiting</div>
<script>
window.addEventListener('message', function (event) {
  var message = event.data
  if (!message || (message.type !== 'ui/initialize' && message.type !== 'ui/data')) return
  document.getElementById('title').textContent = message.data && message.data.title
  parent.postMessage({ type: 'ui/size', height: document.body.scrollHeight }, '*')
})
</script>
</body>
</html>`

const DEFINITION = {
  id: DEFINITION_ID,
  label: DEFINITION_LABEL,
  description: 'A one-line summary rendered by an e2e template',
  icon: 'FileText',
  params: [],
  instructions: 'Publish a title for this session.',
  dataSchema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
    additionalProperties: false,
  },
  renderer: { kind: 'template', html: TEMPLATE_HTML },
  generation: 'currentSession',
}

interface ChatMessage {
  role?: string
  content?: unknown
}

let mockProvider: MockProvider
let mockRepo: MockRepo
let invalidPublishResult: string | null = null

function toolMessages(request: MockChatRequest): ChatMessage[] {
  return ((request.messages ?? []) as ChatMessage[]).filter((message) => message.role === 'tool')
}

function messageText(message: ChatMessage | undefined): string {
  if (!message) return ''
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

function respondWithOutputFlow(request: MockChatRequest): MockTurn {
  if (!Array.isArray(request.tools) || request.tools.length === 0) {
    return { content: 'Outputs e2e' }
  }
  const results = toolMessages(request)
  switch (results.length) {
    case 0:
      return { toolCall: { name: 'ocm', arguments: { action: 'define_output', params: { definition: DEFINITION } } } }
    case 1:
      return {
        toolCall: {
          name: 'ocm',
          arguments: {
            action: 'publish_output',
            params: { definitionId: DEFINITION_ID, data: { title: 'invalid', extra: 1 } },
          },
        },
      }
    case 2:
      invalidPublishResult = messageText(results.at(-1))
      return {
        toolCall: {
          name: 'ocm',
          arguments: { action: 'publish_output', params: { definitionId: DEFINITION_ID, data: { title: PUBLISHED_TITLE } } },
        },
      }
    default:
      return { content: 'done' }
  }
}

async function readOutputStatus(request: APIRequestContext, sessionId: string): Promise<string | null> {
  const response = await request.get(`/api/outputs/${sessionId}?${new URLSearchParams({ definitionId: DEFINITION_ID })}`)
  if (!response.ok()) return null
  const state = (await response.json()) as { output: { status: string } | null }
  return state.output?.status ?? null
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mockProvider = await startMockProvider(MOCK_PROVIDER_PORT)
  mockProvider.setResponder(respondWithOutputFlow)
  mockRepo = await createMockRepo('e2e-outputs-mock-repo', MOCK_PROVIDER_PORT)
})

test.afterAll(async () => {
  await mockProvider.close()
})

test.describe('session outputs', () => {
  test('legacy walkthrough panel URL opens the Outputs panel on the walkthrough output', async ({ page }) => {
    await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}?panel=walkthrough`)

    await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('outputs')
    expect(new URL(page.url()).searchParams.get('output')).toBe('walkthrough')
    await expect(page.locator('aside[aria-label="Outputs"]')).toBeVisible()
  })

  test('agent defines and publishes a current-session template output rendered in a sandboxed frame', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const promptResponse = await request.post(`/api/opencode/api/session/${mockRepo.sessionId}/prompt`, {
      data: { text: 'build the e2e summary output' },
    })
    expect(promptResponse.ok()).toBe(true)

    await expect
      .poll(() => readOutputStatus(request, mockRepo.sessionId), { timeout: 120_000, intervals: [1_000] })
      .toBe('ready')

    expect(invalidPublishResult).toContain('status 400')
    expect(invalidPublishResult).not.toContain('Published the output')

    await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}?panel=outputs&output=${DEFINITION_ID}`)
    const outputsPanel = page.locator('aside[aria-label="Outputs"]')
    await expect(outputsPanel).toBeVisible()

    const frame = outputsPanel.locator(`iframe[title="${DEFINITION_LABEL}"]`)
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts', { timeout: 30_000 })
    await expect(
      outputsPanel.frameLocator(`iframe[title="${DEFINITION_LABEL}"]`).locator('#title'),
    ).toHaveText(PUBLISHED_TITLE, { timeout: 30_000 })
  })

  test('saving a session output definition as global lists it with a global origin', async ({ page, request }) => {
    await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}?panel=outputs&output=${DEFINITION_ID}`)
    const outputsPanel = page.locator('aside[aria-label="Outputs"]')
    await outputsPanel.getByRole('button', { name: 'Save as global' }).click()

    await expect
      .poll(
        async () => {
          const response = await request.get('/api/output-definitions')
          if (!response.ok()) return null
          const body = (await response.json()) as { definitions: Array<{ id: string; origin: string }> }
          return body.definitions.find((definition) => definition.id === DEFINITION_ID)?.origin ?? null
        },
        { timeout: 30_000 },
      )
      .toBe('global')
  })
})
