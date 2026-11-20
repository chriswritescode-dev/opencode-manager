import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
} from '@opencode-manager/shared/opencode'
import { SESSION_USAGE_PAGE_LIMIT } from '@/api/usage'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'
import { renderWithProviders, type TestProviderOptions } from '@/test/render'
import { SessionUsageContent } from './SessionUsageContent'

const providerOptions = { auth: false, theme: false, tts: false } as const

const LOCAL_MESSAGES_PATH = '/api/opencode/api/session/:sessionID/message'

const MODEL_A: ModelRef = { providerID: 'anthropic', id: 'claude' }
const MODEL_B: ModelRef = { providerID: 'openai', id: 'gpt-5' }

const NOW = 1_700_000_000_000

interface AssistantStepOptions {
  id: string
  created: number
  streamed?: number
  model?: ModelRef
  cost?: number
  input?: number
  output?: number
  content?: SessionMessageAssistant['content']
}

function assistantStep({
  id,
  created,
  streamed,
  model,
  cost,
  input,
  output,
  content,
}: AssistantStepOptions): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: model ?? MODEL_A,
    time: streamed === undefined ? { created } : { created, streamed },
    content: content ?? [],
    cost: cost ?? 0,
    tokens: {
      input: input ?? 0,
      output: output ?? 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function bashTool(): SessionMessageAssistantTool {
  return {
    type: 'tool',
    id: 'tool_1',
    name: 'bash',
    time: { created: 1000, ran: 1000, completed: 1500 },
    state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] },
  }
}

interface MessagesRouteOptions {
  serverId?: string
  messages?: SessionMessageAssistant[]
  cursor?: { next?: string; previous?: string }
  status?: number
}

function messagesRoute({
  serverId,
  messages,
  cursor,
  status,
}: MessagesRouteOptions = {}): FetchRoute {
  const path = serverId
    ? `/api/opencode/servers/${serverId}/api/session/:sessionID/message`
    : LOCAL_MESSAGES_PATH
  return {
    method: 'GET',
    path,
    respond: () => ({
      status: status ?? 200,
      json: { data: messages ?? [], cursor: cursor ?? {} },
    }),
  }
}

function statText(label: string): string {
  const grid = screen.getByText('Spend').parentElement?.parentElement
  if (!grid) throw new Error('Summary grid not found')
  return within(grid).getByText(label).parentElement?.textContent ?? ''
}

function assistantPage(page: number): SessionMessageAssistant[] {
  return Array.from({ length: SESSION_USAGE_PAGE_LIMIT }, (_, index) =>
    assistantStep({ id: `msg_${page}_${index}`, created: page * 10_000 + index }),
  )
}

interface RenderOptions {
  sessionId?: string
  serverId?: string
  route?: string
  fetchRoutes: FetchRoute[]
}

function renderContent({ sessionId, serverId, route, fetchRoutes }: RenderOptions) {
  const options: TestProviderOptions = { ...providerOptions, fetchRoutes }
  if (serverId !== undefined) options.serverId = serverId
  if (route !== undefined) options.route = route
  return renderWithProviders(<SessionUsageContent sessionId={sessionId ?? 'ses_1'} />, options)
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeAll(() => {
  installPointerCapture()
})

describe('SessionUsageContent', () => {
  it('renders summary cards, composition, models and tools for loaded local steps', async () => {
    const result = renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [
            assistantStep({
              id: 'msg_1',
              created: 1000,
              streamed: 2000,
              cost: 1.5,
              input: 1000,
              output: 100,
              content: [bashTool()],
            }),
          ],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Token composition' })

    expect(statText('Spend')).toContain('$1.50')
    expect(statText('Avg tokens/s')).toContain('100.0 tok/s')
    expect(statText('Tokens')).toContain('1k')
    expect(statText('Steps')).toContain('1')

    expect(screen.getByRole('heading', { name: 'Token composition' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByText('anthropic/claude')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()

    const request = result.fetchFake.lastRequest('GET', LOCAL_MESSAGES_PATH)
    expect(request?.path).toBe('/api/opencode/api/session/ses_1/message')
    expect(request?.searchParams.get('type')).toBe('assistant')
    expect(request?.searchParams.get('limit')).toBe('200')
  })

  it('filters steps by the selected range', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const user = userEvent.setup()

    renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [
            assistantStep({ id: 'msg_recent', created: NOW - 60_000, cost: 1, input: 1000 }),
            assistantStep({ id: 'msg_old', created: NOW - 7_200_000, cost: 5, input: 3000 }),
          ],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Token composition' })

    expect(statText('Steps')).toContain('2')
    expect(statText('Spend')).toContain('$6.00')
    expect(statText('Tokens')).toContain('4k')

    await user.click(screen.getByRole('combobox', { name: 'Range' }))
    await user.click(screen.getByRole('option', { name: 'Last hour' }))

    await waitFor(() => expect(statText('Steps')).toContain('1'))
    expect(statText('Spend')).toContain('$1.00')
    expect(statText('Tokens')).toContain('1k')
  })

  it('filters the summary and models table by the selected model', async () => {
    const user = userEvent.setup()

    renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [
            assistantStep({ id: 'msg_a', created: 1000, cost: 1, input: 1000, model: MODEL_A }),
            assistantStep({ id: 'msg_b', created: 2000, cost: 2, input: 2000, model: MODEL_B }),
          ],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Models' })

    await user.click(screen.getByRole('button', { name: 'Filter by model' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'openai/gpt-5' }))

    await waitFor(() => expect(statText('Steps')).toContain('1'))
    expect(statText('Spend')).toContain('$2.00')
    expect(statText('Tokens')).toContain('2k')
    expect(screen.queryByText('anthropic/claude')).not.toBeInTheDocument()
    expect(screen.getAllByText('openai/gpt-5').length).toBeGreaterThan(0)
  })

  it('prunes selected models that are no longer in range', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const user = userEvent.setup()

    renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [
            assistantStep({
              id: 'msg_a',
              created: NOW - 7_200_000,
              cost: 1,
              input: 1000,
              model: MODEL_A,
            }),
            assistantStep({
              id: 'msg_b',
              created: NOW - 60_000,
              cost: 2,
              input: 2000,
              model: MODEL_B,
            }),
          ],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Models' })

    await user.click(screen.getByRole('button', { name: 'Filter by model' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' }))
    expect(screen.getByRole('button', { name: 'Filter by model' })).toHaveTextContent(
      'anthropic/claude',
    )

    await user.click(screen.getByRole('combobox', { name: 'Range' }))
    await user.click(screen.getByRole('option', { name: 'Last hour' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Filter by model' })).toHaveTextContent(
        'All models',
      ),
    )
    expect(statText('Steps')).toContain('1')
  })

  it('persists the range selection and keeps the model filter out of storage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const user = userEvent.setup()

    renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [assistantStep({ id: 'msg_a', created: NOW - 1000, cost: 1, input: 1000 })],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Token composition' })

    await user.click(screen.getByRole('combobox', { name: 'Range' }))
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }))

    expect(JSON.parse(window.localStorage.getItem('oc:usage:session-range') ?? 'null')).toEqual({
      preset: '7d',
    })

    await user.click(screen.getByRole('button', { name: 'Filter by model' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' }))

    expect(window.localStorage.getItem('oc:usage:models')).toBeNull()
  })

  it('notes truncation after the fifth page and stops requesting messages', async () => {
    let page = 0

    const result = renderContent({
      fetchRoutes: [
        {
          method: 'GET',
          path: LOCAL_MESSAGES_PATH,
          respond: () => {
            page += 1
            return {
              json: {
                data: assistantPage(page),
                cursor: { next: `cursor_${page}` },
              },
            }
          },
        },
      ],
    })

    await screen.findByText('Only the newest 1,000 steps of this session are summarized.')

    expect(result.fetchFake.findRequests('GET', LOCAL_MESSAGES_PATH)).toHaveLength(5)
  })

  it('asks for a custom range instead of summarizing all time when the range is incomplete', async () => {
    window.localStorage.setItem(
      'oc:usage:session-range',
      JSON.stringify({ preset: 'custom', from: null, to: null }),
    )

    renderContent({
      fetchRoutes: [
        messagesRoute({
          messages: [assistantStep({ id: 'msg_1', created: 1000, cost: 1, input: 1000 })],
        }),
      ],
    })

    expect(
      await screen.findByText('Choose a start and end time to see usage for a custom range.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Custom')
    expect(screen.queryByText('Spend')).not.toBeInTheDocument()
    expect(screen.queryByText('No assistant steps in this range.')).not.toBeInTheDocument()
  })

  it('scrolls compact content inside the panel body', () => {
    const result = renderWithProviders(<SessionUsageContent sessionId="ses_1" compact />, {
      ...providerOptions,
      toaster: false,
      fetchRoutes: [messagesRoute({ messages: [] })],
    })

    expect(result.container.firstElementChild).toHaveClass('overflow-y-auto')
    expect(result.container.firstElementChild).toHaveClass('min-h-0', 'flex-1')
  })

  it('shows the error banner when the request fails', async () => {
    renderContent({ fetchRoutes: [messagesRoute({ status: 500 })] })

    expect(await screen.findByText('Session usage unavailable')).toBeInTheDocument()
  })

  it('shows the empty state when the session has no assistant steps', async () => {
    renderContent({ fetchRoutes: [messagesRoute({ messages: [] })] })

    expect(await screen.findByText('No assistant steps in this range.')).toBeInTheDocument()
  })

  it('loads steps from the linked server route only', async () => {
    const result = renderContent({
      serverId: 'srv_kitchen',
      route: '/servers/srv_kitchen/sessions/ses_1',
      fetchRoutes: [
        messagesRoute({
          serverId: 'srv_kitchen',
          messages: [
            assistantStep({ id: 'msg_remote', created: 1000, cost: 1, input: 1000 }),
          ],
        }),
      ],
    })

    await screen.findByRole('heading', { name: 'Token composition' })

    const request = result.fetchFake.lastRequest(
      'GET',
      '/api/opencode/servers/srv_kitchen/api/session/ses_1/message',
    )
    expect(request?.searchParams.get('type')).toBe('assistant')
    expect(request?.searchParams.get('limit')).toBe('200')
    expect(
      result.fetchFake.findRequests('GET', '/api/opencode/api/session/ses_1/message'),
    ).toHaveLength(0)
  })
})
