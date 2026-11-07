import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import type { OutputParams } from '@opencode-manager/shared/schemas'
import { useAutoOpenOutputs } from '../useAutoOpenOutputs'

const openOutputPart = (
  id: string,
  status: 'running' | 'completed' = 'completed',
): SessionMessageAssistantTool => ({
  type: 'tool',
  id,
  name: 'ocm',
  time: { created: 1 },
  state:
    status === 'completed'
      ? {
          status: 'completed',
          input: { action: 'open_output', params: { definitionId: 'walkthrough' } },
          content: [{ type: 'text', text: 'Output opened' }],
        }
      : {
          status: 'running',
          input: { action: 'open_output', params: { definitionId: 'walkthrough' } },
          metadata: {},
        },
})

const publishOutputPart = (
  id: string,
  params: unknown,
): SessionMessageAssistantTool => ({
  type: 'tool',
  id,
  name: 'ocm',
  time: { created: 1 },
  state: {
    status: 'completed',
    input: { action: 'publish_output', params },
    content: [{ type: 'text', text: 'Output published' }],
  },
})

const otherToolPart = (id: string): SessionMessageAssistantTool => ({
  type: 'tool',
  id,
  name: 'shell',
  time: { created: 1, ran: 2, completed: 3 },
  state: {
    status: 'completed',
    input: { command: 'ls' },
    content: [{ type: 'text', text: 'ok' }],
  },
})

const assistantMessage = (
  id: string,
  ...parts: SessionMessageAssistantTool[]
): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'anthropic', id: 'claude' },
  time: { created: 1, completed: 2 },
  content: parts,
})

interface HookProps {
  sessionId: string
  messages: SessionMessageInfo[]
  enabled: boolean
  loading: boolean
  onOpen: (definitionId: string, params?: OutputParams) => void
}

const renderAutoOpen = (initialProps: HookProps) =>
  renderHook((props: HookProps) => useAutoOpenOutputs(props), { initialProps })

describe('useAutoOpenOutputs', () => {
  it('opens once when an open_output call completes live', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('walkthrough', undefined)
  })

  it('opens when a running open_output call later completes', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1', 'running'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1', 'completed'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens once when a call completes in the last message across streaming updates', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('m1', otherToolPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [
        assistantMessage('m1', otherToolPart('t1')),
        assistantMessage('m2', openOutputPart('t2', 'running')),
      ],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()

    rerender({
      sessionId: 's1',
      messages: [
        assistantMessage('m1', otherToolPart('t1')),
        assistantMessage('m2', openOutputPart('t2', 'completed')),
      ],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('walkthrough', undefined)
  })

  it('passes the requested params to the opener', () => {
    const onOpen = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 't1',
      name: 'ocm',
      time: { created: 1 },
      state: {
        status: 'completed',
        input: {
          action: 'open_output',
          params: { definitionId: 'walkthrough', params: { source: { kind: 'pullRequest', number: 7 } } },
        },
        content: [{ type: 'text', text: 'Output opened' }],
      },
    }
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', part)],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledWith('walkthrough', { source: { kind: 'pullRequest', number: 7 } })
  })

  it('passes no params when nested params do not validate', () => {
    const onOpen = vi.fn()
    const invalid: SessionMessageAssistantTool = {
      type: 'tool',
      id: 't1',
      name: 'ocm',
      time: { created: 1 },
      state: {
        status: 'completed',
        input: { action: 'open_output', params: { definitionId: 'walkthrough', params: 'not-an-object' } },
        content: [{ type: 'text', text: 'Output opened' }],
      },
    }
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', invalid)],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledWith('walkthrough', undefined)
  })

  it('opens the published output when a publish_output call carries a definition id', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [
        assistantMessage('m1', publishOutputPart('t1', { definitionId: 'summary', params: {} })),
      ],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('summary', {})
  })

  it('does not open for a publish_output call without a definition id', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', publishOutputPart('t1', { data: { title: 'Report' } }))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open for a call already completed at the first loaded render', () => {
    const onOpen = vi.fn()

    renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open for historical calls loaded after the initial pending render', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: true,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open while outputs are not enabled', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: false,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', openOutputPart('t1'))],
      enabled: false,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens at most once per tool call id', () => {
    const onOpen = vi.fn()
    const message = assistantMessage('m1', openOutputPart('t1'))
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({ sessionId: 's1', messages: [message], enabled: true, loading: false, onOpen })
    rerender({ sessionId: 's1', messages: [message], enabled: true, loading: false, onOpen })

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('ignores other tools and other ocm actions', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', otherToolPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open a historical call in a different session', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [],
      enabled: true,
      loading: false,
      onOpen,
    })

    rerender({
      sessionId: 's2',
      messages: [assistantMessage('m2', openOutputPart('t2'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open an older call paged in after the initial load', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('msg_010')],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('msg_001', openOutputPart('t_old')), assistantMessage('msg_010')],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })
})
