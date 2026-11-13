import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { FetchFake, FetchRoute } from '@/test/fetchFake'
import { createTestQueryClient, renderHookWithProviders } from '@/test/render'
import { createCommandActionsMock } from '@/test/test-utils'
import { useCommandHandler } from '../useCommandHandler'
import { BUILTIN_COMMANDS, type CommandActions } from '@/lib/builtinCommands'

const builtinCommand = (name: string) => {
  const command = BUILTIN_COMMANDS.find((candidate) => candidate.name === name)
  if (!command) throw new Error(`Unknown built-in command: ${name}`)
  return command
}

const sessionPath = '/api/opencode/api/session/test-session-id'

const sessionInfo = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 'test-session-id',
  projectID: 'proj_1',
  time: { created: 1000, updated: 1000 },
  location: { directory: '/test/dir' },
  agent: 'build',
  model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
  ...overrides,
})

interface HandlerProps {
  actions?: CommandActions
  model?: { providerID: string; id: string; variant?: string }
  currentAgent?: string
  failModelSwitch?: boolean
}

interface HandlerHarness {
  executeCommand: ReturnType<typeof useCommandHandler>['executeCommand']
  actions: CommandActions
  fetchFake: FetchFake
  setSession: (session: SessionInfo) => void
}

function renderHandler(props: HandlerProps = {}): HandlerHarness {
  const actions = props.actions ?? createCommandActionsMock()
  const routes: FetchRoute[] = [
    { method: 'POST', path: `${sessionPath}/command`, respond: () => ({ status: 204 }) },
    {
      method: 'POST',
      path: `${sessionPath}/model`,
      respond: () => (props.failModelSwitch ? { status: 500, text: 'switch failed' } : { status: 204 }),
    },
    { method: 'POST', path: `${sessionPath}/agent`, respond: () => ({ status: 204 }) },
  ]
  const queryClient = createTestQueryClient()
  const { result, fetchFake } = renderHookWithProviders(
    () => useCommandHandler({ sessionID: 'test-session-id', directory: '/test/dir', ...props, actions }),
    { auth: false, theme: false, queryClient, fetchRoutes: routes },
  )
  return {
    executeCommand: result.current.executeCommand,
    actions,
    fetchFake,
    setSession: (session) => queryClient.setQueryData(['opencode', 'session', 'test-session-id', '/test/dir'], session),
  }
}

describe('useCommandHandler', () => {
  it('export dispatches the built-in action without running a server command', async () => {
    const actions = createCommandActionsMock()
    const handler = renderHandler({ actions })
    handler.setSession(sessionInfo())

    const cleared = await handler.executeCommand(builtinCommand('export'), { text: '' })

    expect(actions.exportSession).toHaveBeenCalledWith('')
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/command`)).toHaveLength(0)
    expect(cleared).toBe(true)
  })

  it('runs a server command that shares a built-in name through runCommand', async () => {
    const handler = renderHandler()

    await handler.executeCommand({ name: 'export' }, { text: '' })

    expect(handler.fetchFake.lastRequest('POST', `${sessionPath}/command`)?.body).toEqual({
      name: 'export',
      text: '',
    })
    expect(handler.actions.exportSession).not.toHaveBeenCalled()
  })

  it('clear dispatches the new-session built-in action', async () => {
    const handler = renderHandler()

    await handler.executeCommand(builtinCommand('clear'), { text: '' })

    expect(handler.actions.newSession).toHaveBeenCalled()
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/command`)).toHaveLength(0)
  })

  it('undo dispatches the built-in action and keeps the prompt', async () => {
    const handler = renderHandler()

    const cleared = await handler.executeCommand(builtinCommand('undo'), { text: '' })

    expect(handler.actions.undo).toHaveBeenCalled()
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/command`)).toHaveLength(0)
    expect(cleared).toBe(false)
  })

  it('shows an error toast and keeps the prompt when a built-in action throws', async () => {
    const actions = {
      ...createCommandActionsMock(),
      exportSession: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const handler = renderHandler({ actions })

    const cleared = await handler.executeCommand(builtinCommand('export'), { text: '' })

    expect(cleared).toBe(false)
    expect(await screen.findByText('Command failed: boom')).toBeInTheDocument()
  })

  it('review command runs the V2 command without injecting an agent attachment', async () => {
    const handler = renderHandler({ currentAgent: 'test-agent' })

    await handler.executeCommand({ name: 'review' }, { text: '' })

    expect(handler.fetchFake.lastRequest('POST', `${sessionPath}/command`)?.body).toEqual({
      name: 'review',
      text: '',
    })
  })

  it('unknown command runs the V2 command with the parsed payload', async () => {
    const handler = renderHandler()
    const files = [{ uri: 'file:///test/dir/src/App.tsx', name: 'App.tsx', mention: { start: 0, end: 8, text: '@App.tsx' } }]
    const agents = [{ name: 'reviewer', mention: { start: 9, end: 18, text: '@reviewer' } }]
    const skills = [{ id: 'review' }]

    await handler.executeCommand({ name: 'myskill' }, { text: '@App.tsx @reviewer', files, agents, skills })

    expect(handler.fetchFake.lastRequest('POST', `${sessionPath}/command`)?.body).toEqual({
      name: 'myskill',
      text: '@App.tsx @reviewer',
      files,
      agents,
      skills,
    })
  })

  it('switches model and agent before running the command when the selection changed', async () => {
    const handler = renderHandler({
      model: { providerID: 'openai', id: 'gpt-4', variant: 'v1' },
      currentAgent: 'plan',
    })
    handler.setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    await handler.executeCommand({ name: 'myskill' }, { text: '' })

    expect(handler.fetchFake.lastRequest('POST', `${sessionPath}/agent`)?.body).toEqual({ agent: 'plan' })
    expect(handler.fetchFake.lastRequest('POST', `${sessionPath}/model`)?.body).toEqual({
      model: { providerID: 'openai', id: 'gpt-4', variant: 'v1' },
    })
    const paths = handler.fetchFake.requests.map((request) => request.path)
    expect(paths.indexOf(`${sessionPath}/agent`)).toBeLessThan(paths.indexOf(`${sessionPath}/command`))
    expect(paths.indexOf(`${sessionPath}/model`)).toBeLessThan(paths.indexOf(`${sessionPath}/command`))
  })

  it('does not switch when the selection matches the session', async () => {
    const handler = renderHandler({
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      currentAgent: 'build',
    })
    handler.setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    await handler.executeCommand({ name: 'myskill' }, { text: '' })

    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/model`)).toHaveLength(0)
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/agent`)).toHaveLength(0)
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/command`)).toHaveLength(1)
  })

  it('stops before running the command when the selection switch fails', async () => {
    const handler = renderHandler({
      model: { providerID: 'openai', id: 'gpt-4' },
      currentAgent: 'build',
      failModelSwitch: true,
    })
    handler.setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    const cleared = await handler.executeCommand({ name: 'myskill' }, { text: '' })

    expect(cleared).toBe(false)
    expect(handler.fetchFake.findRequests('POST', `${sessionPath}/command`)).toHaveLength(0)
  })
})
