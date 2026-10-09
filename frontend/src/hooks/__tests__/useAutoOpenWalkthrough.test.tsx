import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { useAutoOpenWalkthrough } from '../useAutoOpenWalkthrough'

const openWalkthroughPart = (
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
          input: { action: 'open_walkthrough', params: {} },
          content: [{ type: 'text', text: 'Walkthrough opened' }],
        }
      : {
          status: 'running',
          input: { action: 'open_walkthrough', params: {} },
          metadata: {},
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
  onOpen: () => void
}

const renderAutoOpen = (initialProps: HookProps) =>
  renderHook((props: HookProps) => useAutoOpenWalkthrough(props), { initialProps })

describe('useAutoOpenWalkthrough', () => {
  it('opens once when an open_walkthrough call completes live', () => {
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
      messages: [assistantMessage('m1', openWalkthroughPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens when a running open_walkthrough call later completes', () => {
    const onOpen = vi.fn()
    const { rerender } = renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('m1', openWalkthroughPart('t1', 'running'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()

    rerender({
      sessionId: 's1',
      messages: [assistantMessage('m1', openWalkthroughPart('t1', 'completed'))],
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
        assistantMessage('m2', openWalkthroughPart('t2', 'running')),
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
        assistantMessage('m2', openWalkthroughPart('t2', 'completed')),
      ],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(undefined)
  })

  it('passes the requested source to the opener', () => {
    const onOpen = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 't1',
      name: 'ocm',
      time: { created: 1 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'pullRequest', number: 7 } } },
        content: [{ type: 'text', text: 'Opened the walkthrough.' }],
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

    expect(onOpen).toHaveBeenCalledWith({ kind: 'pullRequest', number: 7 })
  })

  it('passes no source when the call invalidates one', () => {
    const onOpen = vi.fn()
    const invalid: SessionMessageAssistantTool = {
      type: 'tool',
      id: 't1',
      name: 'ocm',
      time: { created: 1 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'nonsense' } } },
        content: [{ type: 'text', text: 'Opened the walkthrough.' }],
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

    expect(onOpen).toHaveBeenCalledWith(undefined)
  })

  it('does not open for a call already completed at the first loaded render', () => {
    const onOpen = vi.fn()

    renderAutoOpen({
      sessionId: 's1',
      messages: [assistantMessage('m1', openWalkthroughPart('t1'))],
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
      messages: [assistantMessage('m1', openWalkthroughPart('t1'))],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open while the walkthrough is not docked', () => {
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
      messages: [assistantMessage('m1', openWalkthroughPart('t1'))],
      enabled: false,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens at most once per tool call id', () => {
    const onOpen = vi.fn()
    const message = assistantMessage('m1', openWalkthroughPart('t1'))
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
      messages: [assistantMessage('m2', openWalkthroughPart('t2'))],
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
      messages: [assistantMessage('msg_001', openWalkthroughPart('t_old')), assistantMessage('msg_010')],
      enabled: true,
      loading: false,
      onOpen,
    })

    expect(onOpen).not.toHaveBeenCalled()
  })
})
