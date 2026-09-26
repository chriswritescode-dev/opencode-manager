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

export interface TranscriptCache {
  transcript: SessionTranscript
  nextCursor?: string
}

export interface SessionTranscriptBatch {
  transcript: SessionTranscript
  requiresResync: boolean
}

export interface SessionMessageContentUpdatedEvent {
  type: 'session.message.content.updated'
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

interface TranscriptDraft {
  transcript: SessionTranscript
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: SessionTranscript['status']
  retry?: SessionStatus
  messagesChanged: boolean
  pendingChanged: boolean
  statusChanged: boolean
}

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, 'msg_')

function findLastIndex<T>(items: T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && match(item)) return index
  }
  return -1
}

function findMessageIndex(messages: SessionMessageInfo[], messageID: string): number {
  return findLastIndex(messages, (message) => message.id === messageID)
}

function hasMessage(messages: SessionMessageInfo[], messageID: string): boolean {
  return findMessageIndex(messages, messageID) >= 0
}

function findAssistantMessage(
  messages: SessionMessageInfo[],
  messageID: string,
): SessionMessageAssistant | undefined {
  const message = messages[findMessageIndex(messages, messageID)]
  return message?.type === 'assistant' ? message : undefined
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

function createDraft(transcript: SessionTranscript): TranscriptDraft {
  return {
    transcript,
    messages: transcript.messages,
    pending: transcript.pending,
    status: transcript.status,
    retry: transcript.retry,
    messagesChanged: false,
    pendingChanged: false,
    statusChanged: false,
  }
}

function writableMessages(draft: TranscriptDraft): SessionMessageInfo[] {
  if (!draft.messagesChanged) {
    draft.messages = draft.transcript.messages.slice()
    draft.messagesChanged = true
  }
  return draft.messages
}

function writablePending(draft: TranscriptDraft): SessionInboxInfo[] {
  if (!draft.pendingChanged) {
    draft.pending = draft.transcript.pending.slice()
    draft.pendingChanged = true
  }
  return draft.pending
}

function commitDraft(draft: TranscriptDraft): SessionTranscript {
  if (!draft.messagesChanged && !draft.pendingChanged && !draft.statusChanged) {
    return draft.transcript
  }
  return {
    messages: draft.messages,
    pending: draft.pending,
    status: draft.status,
    ...(draft.retry === undefined ? {} : { retry: draft.retry }),
  }
}

function upsertMessage(draft: TranscriptDraft, message: SessionMessageInfo): void {
  const messages = writableMessages(draft)
  const index = findMessageIndex(messages, message.id)
  if (index < 0) messages.push(message)
  else messages[index] = message
}

function removePendingItem(draft: TranscriptDraft, inboxID: string): void {
  const index = findLastIndex(draft.pending, (item) => item.id === inboxID)
  if (index < 0) return
  writablePending(draft).splice(index, 1)
}

function admitInboxItemToDraft(draft: TranscriptDraft, item: SessionInboxInfo): void {
  const pending = writablePending(draft)
  const index = findLastIndex(pending, (entry) => entry.id === item.id)
  if (index < 0) pending.push(item)
  else pending[index] = item
  const materialized = materializeInboxMessage(item)
  if (materialized) upsertMessage(draft, materialized)
}

function retractInboxItemFromDraft(draft: TranscriptDraft, inboxID: string): void {
  const pendingIndex = findLastIndex(draft.pending, (item) => item.id === inboxID)
  if (pendingIndex >= 0) writablePending(draft).splice(pendingIndex, 1)
  const messageIndex = findMessageIndex(draft.messages, inboxID)
  if (messageIndex >= 0) writableMessages(draft).splice(messageIndex, 1)
}

function replaceAssistant(
  draft: TranscriptDraft,
  messageID: string,
  edit: (assistant: SessionMessageAssistant) => SessionMessageAssistant,
): void {
  const index = findMessageIndex(draft.messages, messageID)
  const current = draft.messages[index]
  if (current?.type !== 'assistant') return
  const next = edit(current)
  if (next === current) return
  writableMessages(draft)[index] = next
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
  draft: TranscriptDraft,
  edit: (assistant: SessionMessageAssistant) => SessionMessageAssistant,
): void {
  const index = findLastIndex(
    draft.messages,
    (message) => message.type === 'assistant' && !message.time.completed,
  )
  const active = draft.messages[index]
  if (active?.type !== 'assistant') return
  const next = edit(active)
  if (next === active) return
  writableMessages(draft)[index] = next
}

function appendMessage(draft: TranscriptDraft, message: SessionMessageInfo): void {
  if (hasMessage(draft.messages, message.id)) return
  writableMessages(draft).push(message)
}

function setStatus(
  draft: TranscriptDraft,
  status: SessionTranscript['status'],
  retry?: SessionStatus,
): void {
  if (draft.status === status && draft.retry === retry) return
  draft.status = status
  draft.retry = retry
  draft.statusChanged = true
}

function truncateFrom(draft: TranscriptDraft, to: string): void {
  const pending = writablePending(draft)
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const item = pending[index]
    if (item !== undefined && item.id >= to) pending.splice(index, 1)
  }
  const messages = writableMessages(draft)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (item !== undefined && item.id >= to) messages.splice(index, 1)
  }
}

function latestCompactionIndex(messages: SessionMessageInfo[]): number {
  return findLastIndex(messages, (message) => message.type === 'compaction')
}

function runningCompactionIndex(messages: SessionMessageInfo[]): number {
  return findLastIndex(
    messages,
    (message) => message.type === 'compaction' && message.status === 'running',
  )
}

function isExecutionEndEvent(event: V2Event): boolean {
  return (
    event.type === 'session.execution.succeeded' ||
    event.type === 'session.execution.failed' ||
    event.type === 'session.execution.interrupted'
  )
}

function hasUnsettledTool(messages: SessionMessageInfo[]): boolean {
  return messages.some(
    (message) =>
      message.type === 'assistant' &&
      message.content.some(
        (part) =>
          part.type === 'tool' &&
          (part.state.status === 'streaming' || part.state.status === 'running'),
      ),
  )
}

function hasIncompleteLatestAssistant(messages: SessionMessageInfo[]): boolean {
  const latest = messages[findLastIndex(messages, (message) => message.type === 'assistant')]
  return latest?.type === 'assistant' && !latest.time.completed
}

function hasUnsettledAssistantMessages(messages: SessionMessageInfo[]): boolean {
  return hasUnsettledTool(messages) || hasIncompleteLatestAssistant(messages)
}

export function sessionEventRequiresResync(
  transcript: SessionTranscript,
  event: V2Event | SessionMessageContentUpdatedEvent,
): boolean {
  if (event.type === 'session.message.content.updated') return true
  return isExecutionEndEvent(event) && hasUnsettledAssistantMessages(transcript.messages)
}

function streamedPartKey(event: V2Event): { key: string; started: boolean } | undefined {
  switch (event.type) {
    case 'session.text.started':
    case 'session.text.delta':
      return {
        key: `text:${event.data.assistantMessageID}:${event.data.ordinal}`,
        started: event.type === 'session.text.started',
      }
    case 'session.reasoning.started':
    case 'session.reasoning.delta':
      return {
        key: `reasoning:${event.data.assistantMessageID}:${event.data.ordinal}`,
        started: event.type === 'session.reasoning.started',
      }
    case 'session.tool.input.started':
    case 'session.tool.input.delta':
      return {
        key: `tool:${event.data.assistantMessageID}:${event.data.id}`,
        started: event.type === 'session.tool.input.started',
      }
    case 'session.compaction.started':
    case 'session.compaction.delta':
      return {
        key: `compaction:${event.data.sessionID}`,
        started: event.type === 'session.compaction.started',
      }
    default:
      return undefined
  }
}

function countContentParts(
  message: SessionMessageAssistant | undefined,
  type: 'text' | 'reasoning',
): number {
  if (!message) return 0
  let count = 0
  for (const part of message.content) {
    if (part.type === type) count += 1
  }
  return count
}

function snapshotHasStartedPart(snapshot: SessionTranscript, event: V2Event): boolean {
  switch (event.type) {
    case 'session.text.started':
      return (
        countContentParts(
          findAssistantMessage(snapshot.messages, event.data.assistantMessageID),
          'text',
        ) > event.data.ordinal
      )
    case 'session.reasoning.started':
      return (
        countContentParts(
          findAssistantMessage(snapshot.messages, event.data.assistantMessageID),
          'reasoning',
        ) > event.data.ordinal
      )
    case 'session.tool.input.started': {
      const message = findAssistantMessage(snapshot.messages, event.data.assistantMessageID)
      return (
        message?.content.some((part) => part.type === 'tool' && part.id === event.data.id) ??
        false
      )
    }
    default:
      return false
  }
}

export function eventsReplayableOverSnapshot(
  events: readonly V2Event[],
  snapshot: SessionTranscript,
): V2Event[] {
  const startedAfterSnapshot = new Set<string>()
  return events.filter((event) => {
    const part = streamedPartKey(event)
    if (!part) return true
    if (part.started) {
      if (snapshotHasStartedPart(snapshot, event)) return false
      startedAfterSnapshot.add(part.key)
      return true
    }
    return startedAfterSnapshot.has(part.key)
  })
}

export function admitInboxItem(transcript: SessionTranscript, item: SessionInboxInfo): SessionTranscript {
  const draft = createDraft(transcript)
  admitInboxItemToDraft(draft, item)
  return commitDraft(draft)
}

export function hydrateSessionTranscript(snapshot: SessionSnapshot): SessionTranscript {
  return snapshot.pending.reduce(admitInboxItem, {
    messages: snapshot.messages,
    pending: [],
    status: snapshot.status,
  })
}

export function mergeNewestPage(
  current: TranscriptCache | undefined,
  snapshot: SessionSnapshot,
): TranscriptCache {
  const page = hydrateSessionTranscript(snapshot)
  const replaced = { transcript: page, nextCursor: snapshot.nextCursor }
  if (!current || snapshot.nextCursor === undefined) return replaced
  const pageIDs = new Set(page.messages.map((message) => message.id))
  const overlapIndex = current.transcript.messages.findIndex((message) => pageIDs.has(message.id))
  if (overlapIndex < 0) return replaced
  const older = current.transcript.messages
    .slice(0, overlapIndex)
    .filter((message) => !pageIDs.has(message.id))
  return {
    transcript: { ...page, messages: [...older, ...page.messages] },
    nextCursor: current.nextCursor,
  }
}

function applyEventToDraft(draft: TranscriptDraft, event: V2Event): void {
  switch (event.type) {
    case 'session.inbox.enqueued':
      admitInboxItemToDraft(draft, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        time: { created: event.created },
        ...event.data.item,
      })
      return
    case 'session.inbox.delivered': {
      const wasPending =
        findLastIndex(draft.pending, (item) => item.id === event.data.inboxID) >= 0
      removePendingItem(draft, event.data.inboxID)
      const index = findMessageIndex(draft.messages, event.data.inboxID)
      const message = draft.messages[index]
      if (index < 0 || !wasPending || message === undefined) return
      const messages = writableMessages(draft)
      messages.splice(index, 1)
      messages.push({ ...message, time: { ...message.time, created: event.created } })
      return
    }
    case 'session.inbox.cancelled':
      retractInboxItemFromDraft(draft, event.data.inboxID)
      return
    case 'session.inbox.delivery.changed': {
      const index = findLastIndex(draft.pending, (item) => item.id === event.data.inboxID)
      const current = draft.pending[index]
      if (current === undefined || current.delivery === event.data.delivery) return
      writablePending(draft)[index] = { ...current, delivery: event.data.delivery }
      return
    }
    case 'session.step.started': {
      const { assistantMessageID, agent, model, snapshot, started } = event.data
      const index = findMessageIndex(draft.messages, assistantMessageID)
      const current = draft.messages[index]
      if (current?.type === 'assistant') {
        writableMessages(draft)[index] = {
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
        return
      }
      editActiveAssistant(draft, (active) => ({
        ...active,
        retry: undefined,
        time: { ...active.time, completed: event.created },
      }))
      appendMessage(draft, {
        id: assistantMessageID,
        type: 'assistant',
        agent,
        model,
        metadata: event.metadata,
        content: [],
        ...(snapshot ? { snapshot: { start: snapshot } } : {}),
        time: { created: started },
      })
      return
    }
    case 'session.step.streamed':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        time: { ...assistant.time, streamed: event.created },
      }))
      return
    case 'session.step.ended':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
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
      return
    case 'session.step.failed':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
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
      return
    case 'session.text.started':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        content: [...assistant.content, { type: 'text', text: '' }],
      }))
      return
    case 'session.text.delta':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editText(assistant, (text) => ({ ...text, text: text.text + event.data.delta })),
      )
      return
    case 'session.text.ended':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editText(assistant, (text) => ({
          ...text,
          text: event.data.text,
          ...(event.data.state === undefined ? {} : { state: event.data.state }),
        })),
      )
      return
    case 'session.reasoning.started':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
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
      return
    case 'session.reasoning.delta':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editReasoning(assistant, (reasoning) => ({
          ...reasoning,
          text: reasoning.text + event.data.delta,
        })),
      )
      return
    case 'session.reasoning.ended':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editReasoning(assistant, (reasoning) => ({
          ...reasoning,
          text: event.data.text,
          ...(event.data.state === undefined ? {} : { state: event.data.state }),
          time: { created: reasoning.time?.created ?? event.created, completed: event.created },
        })),
      )
      return
    case 'session.tool.input.started':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
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
      return
    case 'session.tool.input.delta':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'streaming'
            ? { ...tool, state: { status: 'streaming', input: tool.state.input + event.data.delta } }
            : tool,
        ),
      )
      return
    case 'session.tool.input.ended':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'streaming'
            ? { ...tool, state: { status: 'streaming', input: event.data.text } }
            : tool,
        ),
      )
      return
    case 'session.tool.called':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          time: { ...tool.time, ran: event.created },
          state: { status: 'running', input: event.data.input, metadata: {} },
        })),
      )
      return
    case 'session.tool.progress':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
        editTool(assistant, event.data.id, (tool) =>
          tool.state.status === 'running'
            ? { ...tool, state: { ...tool.state, metadata: event.data.metadata } }
            : tool,
        ),
      )
      return
    case 'session.tool.success':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
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
      return
    case 'session.tool.failed':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) =>
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
      return
    case 'session.retry.scheduled':
      replaceAssistant(draft, event.data.assistantMessageID, (assistant) => ({
        ...assistant,
        retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
      }))
      return
    case 'session.shell.started':
      appendMessage(draft, {
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
      return
    case 'session.shell.ended': {
      const index = findLastIndex(
        draft.messages,
        (message) => message.type === 'shell' && message.shellID === event.data.shell.id,
      )
      const current = draft.messages[index]
      if (current?.type !== 'shell') return
      writableMessages(draft)[index] = {
        ...current,
        status: event.data.shell.status,
        exit: event.data.shell.exit,
        output: event.data.output,
        time: { ...current.time, completed: event.created },
      }
      return
    }
    case 'session.synthetic':
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'synthetic',
        text: event.data.text,
        description: event.data.description,
        metadata: event.metadata,
        time: { created: event.created },
      })
      return
    case 'session.skill.activated':
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'skill',
        skill: event.data.id,
        name: event.data.name,
        text: event.data.text,
        metadata: event.metadata,
        time: { created: event.created },
      })
      return
    case 'session.instructions.updated':
      if (event.data.text === undefined) return
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'system',
        text: event.data.text,
        description: `Instructions updated: ${Object.keys(event.data.delta).join(', ')}`,
        metadata: event.metadata,
        time: { created: event.created },
      })
      return
    case 'session.agent.selected':
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'agent-switched',
        agent: event.data.agent,
        previous: event.data.previous,
        time: { created: event.created },
      })
      return
    case 'session.model.selected':
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'model-switched',
        model: event.data.model,
        previous: event.data.previous,
        time: { created: event.created },
      })
      return
    case 'session.moved':
      appendMessage(draft, {
        id: messageIDFromEvent(event.id),
        type: 'location-switched',
        location: event.data.location,
        projectID: event.data.projectID,
        subpath: event.data.subpath,
        time: { created: event.created },
      })
      return
    case 'session.compaction.started': {
      if (event.data.inputID) removePendingItem(draft, event.data.inputID)
      const id = event.data.inputID ?? messageIDFromEvent(event.id)
      if (hasMessage(draft.messages, id)) return
      appendMessage(draft, {
        id,
        type: 'compaction',
        status: 'running',
        reason: event.data.reason,
        summary: '',
        recent: event.data.recent ?? '',
        time: { created: event.created },
      })
      return
    }
    case 'session.compaction.delta': {
      const index = runningCompactionIndex(draft.messages)
      const current = draft.messages[index]
      if (current?.type !== 'compaction' || current.status !== 'running') return
      writableMessages(draft)[index] = { ...current, summary: current.summary + event.data.text }
      return
    }
    case 'session.compaction.ended': {
      const index = runningCompactionIndex(draft.messages)
      const current = draft.messages[index]
      if (current?.type !== 'compaction') {
        const latest = draft.messages[latestCompactionIndex(draft.messages)]
        if (
          latest?.type === 'compaction' &&
          latest.status === 'completed' &&
          latest.summary === event.data.text &&
          latest.recent === event.data.recent
        ) {
          return
        }
        appendMessage(draft, {
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
        return
      }
      writableMessages(draft)[index] = {
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
      return
    }
    case 'session.compaction.failed': {
      if (event.data.inputID) removePendingItem(draft, event.data.inputID)
      const index = latestCompactionIndex(draft.messages)
      const current = draft.messages[index]
      if (current?.type !== 'compaction') {
        appendMessage(draft, {
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
        return
      }
      writableMessages(draft)[index] = {
        ...current,
        status: 'failed',
        reason: event.data.reason,
        error: event.data.error,
        cost: event.data.cost,
        tokens: event.data.tokens,
      }
      return
    }
    case 'session.revert.staged':
    case 'session.revert.cleared':
      return
    case 'session.revert.committed':
      truncateFrom(draft, event.data.to)
      return
    case 'session.status':
      if (event.data.status.type === 'retry') {
        setStatus(draft, 'retry', event.data.status)
        return
      }
      if (event.data.status.type === 'busy') {
        setStatus(draft, 'busy')
        return
      }
      setStatus(draft, 'idle')
      return
    case 'session.idle':
      setStatus(draft, 'idle')
      return
    case 'session.execution.started':
      setStatus(draft, 'busy')
      return
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted': {
      editActiveAssistant(draft, (assistant) =>
        assistant.retry === undefined ? assistant : { ...assistant, retry: undefined },
      )
      setStatus(draft, 'idle')
      if (event.type === 'session.execution.interrupted' && event.data.reason === 'shutdown') {
        return
      }
      appendMessage(draft, {
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
      return
    }
  }
}

export function applySessionEvent(transcript: SessionTranscript, event: V2Event): SessionTranscript {
  const draft = createDraft(transcript)
  applyEventToDraft(draft, event)
  return commitDraft(draft)
}

export function applySessionEvents(
  transcript: SessionTranscript,
  events: readonly V2Event[],
): SessionTranscriptBatch {
  const draft = createDraft(transcript)
  let requiresResync = false
  for (const event of events) {
    applyEventToDraft(draft, event)
    if (sessionEventRequiresResync(draftTranscript(draft), event)) requiresResync = true
  }
  return { transcript: commitDraft(draft), requiresResync }
}

function draftTranscript(draft: TranscriptDraft): SessionTranscript {
  return {
    messages: draft.messages,
    pending: draft.pending,
    status: draft.status,
    ...(draft.retry === undefined ? {} : { retry: draft.retry }),
  }
}
