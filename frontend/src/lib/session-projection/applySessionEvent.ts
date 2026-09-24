import type {
  SessionInboxInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStatus,
  V2Event,
} from '@opencode-manager/shared/opencode'

export interface SessionTranscript {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: 'idle' | 'busy' | 'retry'
  retry?: SessionStatus
}

export interface SessionSnapshot {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: SessionTranscript['status']
  nextCursor?: string
}

export const emptySessionTranscript: SessionTranscript = {
  messages: [],
  pending: [],
  status: 'idle',
}

type AssistantContent = SessionMessageAssistant['content'][number]
type AssistantText = Extract<AssistantContent, { type: 'text' }>
type AssistantReasoning = Extract<AssistantContent, { type: 'reasoning' }>
type AssistantTool = Extract<AssistantContent, { type: 'tool' }>

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, 'msg_')

function findLastIndex<T>(items: T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && match(item)) return index
  }
  return -1
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = findLastIndex(items, (entry) => entry.id === item.id)
  if (index < 0) return [...items, item]
  const next = items.slice()
  next[index] = item
  return next
}

function materializeInboxMessage(item: SessionInboxInfo): SessionMessageInfo | undefined {
  if (item.type === 'user') {
    return { id: item.id, type: 'user', ...item.payload, time: { created: item.time.created } }
  }
  if (item.type === 'synthetic') {
    return { id: item.id, type: 'synthetic', ...item.payload, time: { created: item.time.created } }
  }
  return undefined
}

export function admitInboxItem(transcript: SessionTranscript, item: SessionInboxInfo): SessionTranscript {
  const pending = upsertById(transcript.pending, item)
  const materialized = materializeInboxMessage(item)
  const messages = materialized ? upsertById(transcript.messages, materialized) : transcript.messages
  return { ...transcript, pending, messages }
}

function removePending(transcript: SessionTranscript, inboxID: string): SessionTranscript {
  const pending = transcript.pending.filter((item) => item.id !== inboxID)
  if (pending.length === transcript.pending.length) return transcript
  return { ...transcript, pending }
}

function retractInboxItem(transcript: SessionTranscript, inboxID: string): SessionTranscript {
  const pending = transcript.pending.filter((item) => item.id !== inboxID)
  const index = findLastIndex(transcript.messages, (message) => message.id === inboxID)
  if (index < 0) {
    if (pending.length === transcript.pending.length) return transcript
    return { ...transcript, pending }
  }
  const messages = transcript.messages.slice()
  messages.splice(index, 1)
  return { ...transcript, pending, messages }
}

function replaceAssistant(
  transcript: SessionTranscript,
  messageID: string,
  edit: (assistant: SessionMessageAssistant) => SessionMessageAssistant,
): SessionTranscript {
  const index = findLastIndex(transcript.messages, (message) => message.id === messageID)
  const current = transcript.messages[index]
  if (current?.type !== 'assistant') return transcript
  const next = edit(current)
  if (next === current) return transcript
  const messages = transcript.messages.slice()
  messages[index] = next
  return { ...transcript, messages }
}

function replaceContent(
  assistant: SessionMessageAssistant,
  content: SessionMessageAssistant['content'],
): SessionMessageAssistant {
  return { ...assistant, content }
}

function editContentPart<Part extends AssistantContent>(
  assistant: SessionMessageAssistant,
  index: number,
  edit: (part: Part) => Part,
): SessionMessageAssistant {
  const current = assistant.content[index]
  if (current === undefined) return assistant
  const next = edit(current as Part)
  if (next === current) return assistant
  const content = assistant.content.slice()
  content[index] = next
  return replaceContent(assistant, content)
}

function editText(
  assistant: SessionMessageAssistant,
  edit: (text: AssistantText) => AssistantText,
): SessionMessageAssistant {
  const index = findLastIndex(assistant.content, (part) => part.type === 'text')
  if (assistant.content[index]?.type !== 'text') return assistant
  return editContentPart(assistant, index, edit)
}

function editReasoning(
  assistant: SessionMessageAssistant,
  edit: (reasoning: AssistantReasoning) => AssistantReasoning,
): SessionMessageAssistant {
  const index = findLastIndex(
    assistant.content,
    (part) => part.type === 'reasoning' && !part.time?.completed,
  )
  if (assistant.content[index]?.type !== 'reasoning') return assistant
  return editContentPart(assistant, index, edit)
}

function editTool(
  assistant: SessionMessageAssistant,
  toolID: string,
  edit: (tool: AssistantTool) => AssistantTool,
): SessionMessageAssistant {
  const index = findLastIndex(
    assistant.content,
    (part) => part.type === 'tool' && part.id === toolID,
  )
  if (assistant.content[index]?.type !== 'tool') return assistant
  return editContentPart(assistant, index, edit)
}

function editActiveAssistant(
  transcript: SessionTranscript,
  edit: (assistant: SessionMessageAssistant) => SessionMessageAssistant,
): SessionTranscript {
  const index = findLastIndex(
    transcript.messages,
    (message) => message.type === 'assistant' && !message.time.completed,
  )
  const active = transcript.messages[index]
  if (active?.type !== 'assistant') return transcript
  const next = edit(active)
  if (next === active) return transcript
  const messages = transcript.messages.slice()
  messages[index] = next
  return { ...transcript, messages }
}

function setStatus(
  transcript: SessionTranscript,
  status: SessionTranscript['status'],
  retry?: SessionStatus,
): SessionTranscript {
  if (transcript.status === status && transcript.retry === retry) return transcript
  return { ...transcript, status, retry }
}

function appendMessage(transcript: SessionTranscript, message: SessionMessageInfo): SessionTranscript {
  if (hasMessage(transcript, message.id)) return transcript
  return { ...transcript, messages: [...transcript.messages, message] }
}

function hasMessage(transcript: SessionTranscript, messageID: string): boolean {
  return findLastIndex(transcript.messages, (message) => message.id === messageID) >= 0
}

function latestCompactionIndex(transcript: SessionTranscript): number {
  return findLastIndex(transcript.messages, (message) => message.type === 'compaction')
}

export function hydrateSessionTranscript(snapshot: SessionSnapshot): SessionTranscript {
  return snapshot.pending.reduce(admitInboxItem, {
    messages: snapshot.messages,
    pending: [],
    status: snapshot.status,
  })
}

export function sessionIDFromEvent(event: V2Event): string | undefined {
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return undefined
  if (!('sessionID' in data) || typeof data.sessionID !== 'string') return undefined
  return data.sessionID
}

export function applySessionEvent(transcript: SessionTranscript, event: V2Event): SessionTranscript {
  switch (event.type) {
    case 'session.inbox.enqueued':
      return admitInboxItem(transcript, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        time: { created: event.created },
        ...event.data.item,
      })
    case 'session.inbox.delivered': {
      const wasPending = findLastIndex(transcript.pending, (item) => item.id === event.data.inboxID) >= 0
      const pending = removePending(transcript, event.data.inboxID)
      const index = findLastIndex(transcript.messages, (message) => message.id === event.data.inboxID)
      const message = transcript.messages[index]
      if (index < 0 || !wasPending || message === undefined) return pending
      const messages = transcript.messages.slice()
      messages.splice(index, 1)
      messages.push({ ...message, time: { ...message.time, created: event.created } })
      return { ...pending, messages }
    }
    case 'session.inbox.cancelled':
      return retractInboxItem(transcript, event.data.inboxID)
    case 'session.inbox.delivery.changed': {
      const index = findLastIndex(transcript.pending, (item) => item.id === event.data.inboxID)
      const current = transcript.pending[index]
      if (current === undefined || current.delivery === event.data.delivery) return transcript
      const pending = transcript.pending.slice()
      pending[index] = { ...current, delivery: event.data.delivery }
      return { ...transcript, pending }
    }
    case 'session.step.started': {
      const { assistantMessageID, agent, model, snapshot, started } = event.data
      const index = findLastIndex(transcript.messages, (message) => message.id === assistantMessageID)
      const current = transcript.messages[index]
      if (current?.type === 'assistant') {
        const messages = transcript.messages.slice()
        messages[index] = {
          ...current,
          agent,
          model,
          retry: undefined,
          error: undefined,
          finish: undefined,
          rawFinish: undefined,
          providerState: undefined,
          time: { created: started, streamed: undefined, completed: undefined },
          ...(snapshot ? { snapshot: { ...current.snapshot, start: snapshot } } : {}),
        }
        return { ...transcript, messages }
      }
      const completed = editActiveAssistant(transcript, (active) => ({
        ...active,
        retry: undefined,
        time: { ...active.time, completed: event.created },
      }))
      return appendMessage(completed, {
        id: assistantMessageID,
        type: 'assistant',
        agent,
        model,
        metadata: event.metadata,
        content: [],
        ...(snapshot ? { snapshot: { start: snapshot } } : {}),
        time: { created: started },
      })
    }
    case 'session.step.streamed':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        time: { ...assistant.time, streamed: event.created },
      }))
    case 'session.step.ended':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        time: { ...assistant.time, completed: event.created },
        finish: event.data.finish,
        rawFinish: event.data.rawFinish,
        providerState: event.data.providerState,
        cost: event.data.cost,
        tokens: event.data.tokens,
        ...(event.data.snapshot || event.data.files
          ? {
              snapshot: {
                ...assistant.snapshot,
                end: event.data.snapshot,
                files: event.data.files,
              },
            }
          : {}),
      }))
    case 'session.step.failed':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        time: { ...assistant.time, completed: event.created },
        finish: event.data.finish ?? 'error',
        rawFinish: event.data.rawFinish,
        providerState: event.data.providerState,
        error: event.data.error,
        retry: undefined,
        ...(event.data.cost !== undefined && event.data.tokens !== undefined
          ? { cost: event.data.cost, tokens: event.data.tokens }
          : {}),
        ...(event.data.snapshot || event.data.files
          ? {
              snapshot: {
                ...assistant.snapshot,
                end: event.data.snapshot,
                files: event.data.files,
              },
            }
          : {}),
      }))
    case 'session.text.started':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        content: [...assistant.content, { type: 'text', text: '' }],
      }))
    case 'session.text.delta':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editText(assistant, (text) => ({ ...text, text: text.text + event.data.delta })),
      )
    case 'session.text.ended':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editText(assistant, (text) => ({
          ...text,
          text: event.data.text,
          ...(event.data.state === undefined ? {} : { state: event.data.state }),
        })),
      )
    case 'session.reasoning.started':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        content: [
          ...assistant.content,
          {
            type: 'reasoning',
            text: '',
            ...(event.data.state === undefined ? {} : { state: event.data.state }),
            time: { created: event.created },
          },
        ],
      }))
    case 'session.reasoning.delta':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editReasoning(assistant, (reasoning) => ({
          ...reasoning,
          text: reasoning.text + event.data.delta,
        })),
      )
    case 'session.reasoning.ended':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editReasoning(assistant, (reasoning) => ({
          ...reasoning,
          text: event.data.text,
          ...(event.data.state === undefined ? {} : { state: event.data.state }),
          time: { created: reasoning.time?.created ?? event.created, completed: event.created },
        })),
      )
    case 'session.tool.input.started':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        content: [
          ...assistant.content,
          {
            type: 'tool',
            id: event.data.id,
            name: event.data.name,
            time: { created: event.created },
            state: { status: 'streaming', input: '' },
          },
        ],
      }))
    case 'session.tool.input.delta':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'streaming'
            ? { ...tool, state: { status: 'streaming', input: tool.state.input + event.data.delta } }
            : tool,
        ),
      )
    case 'session.tool.input.ended':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'streaming'
            ? { ...tool, state: { status: 'streaming', input: event.data.text } }
            : tool,
        ),
      )
    case 'session.tool.called':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          time: { ...tool.time, ran: event.created },
          state: { status: 'running', input: event.data.input, metadata: {} },
        })),
      )
    case 'session.tool.progress':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'running'
            ? { ...tool, state: { ...tool.state, metadata: event.data.metadata } }
            : tool,
        ),
      )
    case 'session.tool.success':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) => {
          if (tool.state.status !== 'running') return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            time: { ...tool.time, completed: event.created },
            state: {
              status: 'completed',
              input: tool.state.input,
              metadata: event.data.metadata,
              content: event.data.content,
            },
          }
        }),
      )
    case 'session.tool.failed':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) => {
          if (tool.state.status !== 'streaming' && tool.state.status !== 'running') return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            time: { ...tool.time, completed: event.created },
            state: {
              status: 'error',
              error: event.data.error,
              input: typeof tool.state.input === 'string' ? {} : tool.state.input,
              metadata: event.data.metadata,
              content: event.data.content,
            },
          }
        }),
      )
    case 'session.retry.scheduled':
      return replaceAssistant(transcript, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
      }))
    case 'session.shell.started':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'shell',
        shellID: event.data.shell.id,
        command: event.data.shell.command,
        status: event.data.shell.status,
        exit: event.data.shell.exit,
        metadata:
          event.data.shell.metadata.background === true
            ? { ...event.metadata, background: true }
            : event.metadata,
        time: { created: event.created },
      })
    case 'session.shell.ended': {
      const index = findLastIndex(
        transcript.messages,
        (message) => message.type === 'shell' && message.shellID === event.data.shell.id,
      )
      const current = transcript.messages[index]
      if (current?.type !== 'shell') return transcript
      const messages = transcript.messages.slice()
      messages[index] = {
        ...current,
        status: event.data.shell.status,
        exit: event.data.shell.exit,
        output: event.data.output,
        time: { ...current.time, completed: event.created },
      }
      return { ...transcript, messages }
    }
    case 'session.synthetic':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'synthetic',
        text: event.data.text,
        description: event.data.description,
        metadata: event.data.metadata,
        time: { created: event.created },
      })
    case 'session.skill.activated':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'skill',
        skill: event.data.id,
        name: event.data.name,
        text: event.data.text,
        metadata: event.metadata,
        time: { created: event.created },
      })
    case 'session.instructions.updated':
      if (event.data.text === undefined) return transcript
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'system',
        text: event.data.text,
        description: `Instructions updated: ${Object.keys(event.data.delta).join(', ')}`,
        metadata: event.metadata,
        time: { created: event.created },
      })
    case 'session.agent.selected':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'agent-switched',
        agent: event.data.agent,
        previous: event.data.previous,
        time: { created: event.created },
      })
    case 'session.model.selected':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'model-switched',
        model: event.data.model,
        previous: event.data.previous,
        time: { created: event.created },
      })
    case 'session.moved':
      return appendMessage(transcript, {
        id: messageIDFromEvent(event.id),
        type: 'location-switched',
        location: event.data.location,
        projectID: event.data.projectID,
        subpath: event.data.subpath,
        time: { created: event.created },
      })
    case 'session.compaction.started': {
      const base = event.data.inputID ? removePending(transcript, event.data.inputID) : transcript
      const id = event.data.inputID ?? messageIDFromEvent(event.id)
      if (hasMessage(base, id)) return base
      return appendMessage(base, {
        id,
        type: 'compaction',
        status: 'running',
        reason: event.data.reason,
        summary: '',
        recent: event.data.recent ?? '',
        time: { created: event.created },
      })
    }
    case 'session.compaction.delta': {
      const index = findLastIndex(
        transcript.messages,
        (message) => message.type === 'compaction' && message.status === 'running',
      )
      const current = transcript.messages[index]
      if (current?.type !== 'compaction' || current.status !== 'running') return transcript
      const messages = transcript.messages.slice()
      messages[index] = { ...current, summary: current.summary + event.data.text }
      return { ...transcript, messages }
    }
    case 'session.compaction.ended': {
      const index = latestCompactionIndex(transcript)
      const current = transcript.messages[index]
      if (current?.type !== 'compaction') {
        return appendMessage(transcript, {
          id: messageIDFromEvent(event.id),
          type: 'compaction',
          status: 'completed',
          reason: event.data.reason,
          model: event.data.model,
          providerState: event.data.providerState,
          summary: event.data.text,
          recent: event.data.recent,
          cost: event.data.cost,
          tokens: event.data.tokens,
          time: { created: event.created },
        })
      }
      const messages = transcript.messages.slice()
      messages[index] = {
        ...current,
        status: 'completed',
        reason: event.data.reason,
        model: event.data.model,
        providerState: event.data.providerState,
        summary: event.data.text,
        recent: event.data.recent,
        cost: event.data.cost,
        tokens: event.data.tokens,
        metadata: event.metadata ? { ...current.metadata, ...event.metadata } : current.metadata,
      }
      return { ...transcript, messages }
    }
    case 'session.compaction.failed': {
      const pending = event.data.inputID
        ? removePending(transcript, event.data.inputID)
        : transcript
      const index = latestCompactionIndex(pending)
      const current = pending.messages[index]
      if (current?.type !== 'compaction') {
        return appendMessage(pending, {
          id: event.data.inputID ?? messageIDFromEvent(event.id),
          type: 'compaction',
          status: 'failed',
          reason: event.data.reason,
          error: event.data.error,
          metadata: event.metadata,
          cost: event.data.cost,
          tokens: event.data.tokens,
          time: { created: event.created },
        })
      }
      const messages = pending.messages.slice()
      messages[index] = {
        ...current,
        status: 'failed',
        reason: event.data.reason,
        error: event.data.error,
        cost: event.data.cost,
        tokens: event.data.tokens,
      }
      return { ...pending, messages }
    }
    case 'session.revert.staged':
    case 'session.revert.cleared':
      return transcript
    case 'session.revert.committed': {
      const pending = transcript.pending.filter((item) => item.id < event.data.to)
      const messages = transcript.messages.filter((message) => message.id < event.data.to)
      return { ...transcript, pending, messages }
    }
    case 'session.status':
      if (event.data.status.type === 'retry') {
        return setStatus(transcript, 'retry', event.data.status)
      }
      if (event.data.status.type === 'busy') return setStatus(transcript, 'busy')
      return setStatus(transcript, 'idle')
    case 'session.idle':
      return setStatus(transcript, 'idle')
    case 'session.execution.started':
      return setStatus(transcript, 'busy')
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted': {
      const idle = setStatus(
        editActiveAssistant(transcript, (assistant) =>
          assistant.retry === undefined ? assistant : { ...assistant, retry: undefined },
        ),
        'idle',
      )
      if (event.type === 'session.execution.interrupted' && event.data.reason === 'shutdown') {
        return idle
      }
      return appendMessage(idle, {
        id: messageIDFromEvent(event.id),
        type: 'idle',
        outcome:
          event.type === 'session.execution.succeeded'
            ? 'succeeded'
            : event.type === 'session.execution.failed'
              ? 'failed'
              : 'interrupted',
        metadata: event.metadata,
        time: { created: event.created },
      })
    }
  }
  return transcript
}
