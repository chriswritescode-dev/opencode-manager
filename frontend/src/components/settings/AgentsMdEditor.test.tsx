import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { AgentsMdEditor } from './AgentsMdEditor'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const DEFAULT_CONTENT = '# Rules\n\nline two\nline three\n'

const agentsMdRequestSchema = z.object({ content: z.string() })

interface AgentsMdServerOptions {
  initialContent?: string
  putResult?: FetchRouteResult
  deferSave?: boolean
  deferRefetch?: boolean
}

function createAgentsMdServer(options: AgentsMdServerOptions = {}) {
  let content = options.initialContent ?? DEFAULT_CONTENT
  let reads = 0
  let releaseSave: (() => void) | undefined
  let releaseRefetch: (() => void) | undefined
  let saveGate = options.deferSave ? new Promise<void>((resolve) => { releaseSave = resolve }) : null

  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/settings/agents-md',
      respond: async () => {
        reads += 1
        if (reads > 1 && options.deferRefetch) {
          await new Promise<void>((resolve) => { releaseRefetch = resolve })
        }
        return { json: { content } }
      },
    },
    {
      method: 'PUT',
      path: '/api/settings/agents-md',
      respond: async (request) => {
        const body = agentsMdRequestSchema.parse(request.body)
        if (saveGate) {
          await saveGate
          saveGate = null
        }
        content = body.content
        return options.putResult ?? { json: { success: true, restartRequired: false } }
      },
    },
    {
      method: 'GET',
      path: '/api/settings/agents-md/default',
      respond: () => ({ json: { content: '# Default' } }),
    },
  ]

  return {
    routes,
    reads: () => reads,
    releaseSave: () => releaseSave?.(),
    releaseRefetch: () => releaseRefetch?.(),
  }
}

function renderEditor(options: AgentsMdServerOptions = {}) {
  const server = createAgentsMdServer(options)
  const result = renderWithProviders(<AgentsMdEditor />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: server.routes,
  })
  return { ...result, ...server }
}

async function findTextarea() {
  return screen.findByLabelText('AGENTS.md content')
}

describe('AgentsMdEditor', () => {
  it('loads the current AGENTS.md into the editor', async () => {
    renderEditor()

    expect(await findTextarea()).toHaveValue(DEFAULT_CONTENT)
  })

  it('renders a line number gutter', async () => {
    renderEditor()
    await findTextarea()

    const numbers = Array.from(document.body.querySelectorAll('[data-line-number]'))
    expect(numbers.map((n) => n.textContent?.trim())).toEqual(['1', '2', '3', '4', '5'])
  })

  it('finds matches in the content', async () => {
    const user = userEvent.setup()
    renderEditor()
    await findTextarea()

    await user.type(screen.getByLabelText('Find in content'), 'line')

    expect(screen.getByTestId('find-match-count')).toHaveTextContent('1 of 2')
    expect(document.body.querySelectorAll('mark')).toHaveLength(2)
  })

  it('keeps Save disabled until the content changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    const saveButton = await screen.findByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()

    await user.type(await findTextarea(), '!')

    expect(saveButton).toBeEnabled()
  })

  it('saves the edited content', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor()
    const textarea = await findTextarea()
    const edited = `${DEFAULT_CONTENT}# new section\n`
    fireEvent.change(textarea, { target: { value: edited } })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetchFake.lastRequest('PUT', '/api/settings/agents-md')?.body).toEqual({ content: edited })
  })

  it('uses a 16px editor font on mobile', async () => {
    renderEditor()

    const textarea = await findTextarea()
    expect(textarea.className).toContain('text-[16px]')
    expect(textarea.className).toContain('min-[769px]:text-sm')
    expect(textarea.className).not.toContain('text-xs')
  })

  it('locks the editor while a save is pending and preserves submitted content', async () => {
    const user = userEvent.setup()
    const { releaseSave } = renderEditor({ deferSave: true })
    const textarea = await findTextarea()
    const edited = `${DEFAULT_CONTENT}edit\n`
    fireEvent.change(textarea, { target: { value: edited } })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(textarea).toBeDisabled())
    await user.type(textarea, 'lost edit').catch(() => undefined)
    expect(textarea).toHaveValue(edited)

    releaseSave()

    await waitFor(() => expect(textarea).not.toBeDisabled())
    expect(textarea).toHaveValue(edited)
  })

  it('preserves a post-save edit when a deferred refetch arrives with the saved value', async () => {
    const user = userEvent.setup()
    const { reads, releaseRefetch } = renderEditor({ deferRefetch: true })
    const textarea = await findTextarea()
    await waitFor(() => expect(textarea).toHaveValue(DEFAULT_CONTENT))

    fireEvent.change(textarea, { target: { value: 'B' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(2))

    fireEvent.change(textarea, { target: { value: 'A' } })
    releaseRefetch()

    await waitFor(() => expect(reads()).toBe(2))
    expect(textarea).toHaveValue('A')
  })

  it('reports a save as applied without a restart', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = await findTextarea()
    fireEvent.change(textarea, { target: { value: `${DEFAULT_CONTENT}applied\n` } })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('AGENTS.md saved')).toBeInTheDocument()
  })

  it('requests a restart when the in-place reload fails', async () => {
    const user = userEvent.setup()
    renderEditor({ putResult: { json: { success: true, restartRequired: true } } })
    const textarea = await findTextarea()
    fireEvent.change(textarea, { target: { value: `${DEFAULT_CONTENT}needs restart\n` } })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(
        'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.',
      ),
    ).toBeInTheDocument()
  })

  it('resets to the default content and reports it as applied', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor()
    await findTextarea()

    await user.click(screen.getByRole('button', { name: 'Reset to Default' }))

    expect(await screen.findByText('AGENTS.md reset to default')).toBeInTheDocument()
    expect(fetchFake.lastRequest('PUT', '/api/settings/agents-md')?.body).toEqual({ content: '# Default' })
  })
})
