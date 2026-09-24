import { memo, useCallback, useMemo, useState } from 'react'
import { Pencil, Loader2, Volume2, VolumeX } from 'lucide-react'
import { assistantText } from '@opencode-manager/shared/opencode'
import type {
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptSkillAttachment,
  SessionInboxInfo,
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageInfo,
  SessionMessageShell,
} from '@opencode-manager/shared/opencode'
import { MessagePart } from './MessagePart'
import { MessageError } from './MessageError'
import { RetryPart } from './RetryPart'
import { StepFileChanges } from './StepFileChanges'
import { UserMessageActionButtons } from './UserMessageActionButtons'
import { EditableUserMessage, ClickableUserMessage } from './EditableUserMessage'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { CopyButton } from '@/components/ui/copy-button'

function getMessageText(message: SessionMessageInfo): string {
  switch (message.type) {
    case 'user':
      return message.text
    case 'assistant':
      return assistantText(message.content).trim()
    case 'synthetic':
    case 'system':
    case 'skill':
      return message.text
    case 'shell':
      return message.command
    default:
      return ''
  }
}

function isSubagentTool(
  part: SessionMessageAssistant['content'][number],
): part is SessionMessageAssistantTool {
  return part.type === 'tool' && part.name === 'subagent'
}

function hasRenderableContent(
  message: SessionMessageInfo,
  simpleChatMode: boolean,
  showReasoning: boolean,
): boolean {
  switch (message.type) {
    case 'user':
      return message.text.trim().length > 0 || (message.files?.length ?? 0) > 0
    case 'assistant':
      if (!simpleChatMode && (message.snapshot?.files?.length ?? 0) > 0) return true
      return message.content.some((part) => {
        if (part.type === 'text') return part.text.trim().length > 0
        if (part.type === 'reasoning') return !simpleChatMode && showReasoning && part.text.trim().length > 0
        if (part.type === 'tool') return !simpleChatMode || isSubagentTool(part)
        return false
      })
    case 'synthetic':
    case 'system':
      return message.text.trim().length > 0
    case 'shell':
    case 'skill':
    case 'compaction':
    case 'agent-switched':
    case 'model-switched':
    case 'location-switched':
      return true
    default:
      return false
  }
}

function isStandaloneSubAgentMessage(message: SessionMessageInfo): boolean {
  if (message.type !== 'assistant') return false
  if (message.error !== undefined || message.retry !== undefined) return false
  return message.content.length > 0 && message.content.every(isSubagentTool)
}

function findLastUserMessageId(messages: SessionMessageInfo[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'user') return message.id
  }
  return undefined
}

function attachmentLabel(attachment: PromptFileAttachment): string {
  if (attachment.name) return attachment.name
  if (attachment.source.type === 'uri') {
    const segments = attachment.source.uri.split('/')
    return segments[segments.length - 1] || attachment.source.uri
  }
  return 'File'
}

interface UserAttachmentsProps {
  files?: PromptFileAttachment[]
  agents?: PromptAgentAttachment[]
  skills?: PromptSkillAttachment[]
}

function UserAttachments({ files: attachedFiles, agents: attachedAgents, skills: attachedSkills }: UserAttachmentsProps) {
  const files = attachedFiles ?? []
  const agents = attachedAgents ?? []
  const skills = attachedSkills ?? []

  if (files.length === 0 && agents.length === 0 && skills.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {files.map((file, index) => (
        <span
          key={`file-${index}`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted border border-border text-sm text-foreground"
        >
          <span className="text-blue-600 dark:text-blue-400">@</span>
          <span className="font-medium">{attachmentLabel(file)}</span>
        </span>
      ))}
      {agents.map((agent, index) => (
        <span
          key={`agent-${index}`}
          className="inline-flex items-center px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-xs text-purple-600 dark:text-purple-400"
        >
          agent: {agent.name}
        </span>
      ))}
      {skills.map((skill, index) => (
        <span
          key={`skill-${index}`}
          className="inline-flex items-center px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-xs text-blue-600 dark:text-blue-400"
        >
          skill: {skill.name}
        </span>
      ))}
    </div>
  )
}

interface TTSButtonProps {
  messageId: string
  content: string
}

function TTSButton({ messageId, content }: TTSButtonProps) {
  const { speakMessage, stop, isEnabled, isPlaying, isLoading, activeMessageId } = useTTS()

  if (!isEnabled || !content.trim()) {
    return null
  }

  const isThisPlaying = (isPlaying || isLoading) && activeMessageId === messageId

  const handleClick = () => {
    if (isThisPlaying) {
      stop()
    } else {
      speakMessage(messageId, content)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`p-1.5 rounded ${isThisPlaying ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground'}`}
      title={isThisPlaying ? 'Stop playback' : 'Read aloud'}
      disabled={isLoading && !isThisPlaying}
    >
      {isLoading && isThisPlaying ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isThisPlaying ? (
        <VolumeX className="w-4 h-4" />
      ) : (
        <Volume2 className="w-4 h-4" />
      )}
    </button>
  )
}

function MessageDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function ShellMessage({ message }: { message: SessionMessageShell }) {
  const output = message.output?.output ?? ''
  const statusLabel = message.status === 'running'
    ? 'running'
    : message.exit === undefined
      ? message.status
      : `${message.status} (exit ${message.exit})`

  return (
    <div className="rounded-lg border border-border bg-card/50 p-2 my-1">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-green-600 dark:text-green-400 shrink-0">$</span>
        <span className="text-foreground truncate">{message.command}</span>
        <span className="text-muted-foreground text-xs ml-auto shrink-0">{statusLabel}</span>
      </div>
      {output && (
        <div className="relative mt-1">
          <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap">{output}</pre>
          <CopyButton content={output} title="Copy output" className="absolute top-1 right-1" iconSize="sm" />
        </div>
      )}
    </div>
  )
}

function CompactionBanner({ message }: { message: SessionMessageCompaction }) {
  if (message.status === 'running') {
    return (
      <div className="flex items-center gap-2 my-1 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Compacting session...</span>
      </div>
    )
  }

  if (message.status === 'failed') {
    return (
      <div className="my-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
        Compaction failed: {message.error.message}
      </div>
    )
  }

  return (
    <div className="my-1 rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium">Session compacted</span>
      {message.summary && <p className="mt-0.5 whitespace-pre-wrap">{message.summary}</p>}
    </div>
  )
}

function QueuedPromptRow({ item }: { item: SessionInboxUser }) {
  return (
    <div className="w-full rounded-lg p-1.5 bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-muted-foreground">You</span>
        <span className="text-xs text-muted-foreground">
          {new Date(item.time.created).toLocaleTimeString()}
        </span>
        <span className="text-xs font-semibold bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded">
          {item.delivery === 'queue' ? 'QUEUED' : 'STEERING'}
        </span>
      </div>
      <ClickableUserMessage content={item.payload.text} onClick={() => {}} isEditable={false} />
      <UserAttachments
        files={item.payload.files}
        agents={item.payload.agents}
        skills={item.payload.skills}
      />
    </div>
  )
}

interface MessageRowProps {
  message: SessionMessageInfo
  nextAssistantMessageId: string | undefined
  isLastUserMessage: boolean
  isSessionBusy: boolean
  onUndoMessage?: (restoredPrompt: string) => void
  editingUserMessageId: string | null
  handleStartEditUserMessage: (userMessageId: string, assistantMessageId: string) => void
  handleCancelEdit: () => void
  sessionID: string
  directory?: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  model?: string
  simpleChatMode: boolean
  showReasoning: boolean
}

const MessageRow = memo(function MessageRow({
  message,
  nextAssistantMessageId,
  isLastUserMessage,
  isSessionBusy,
  onUndoMessage,
  editingUserMessageId,
  handleStartEditUserMessage,
  handleCancelEdit,
  sessionID,
  directory,
  onFileClick,
  onChildSessionClick,
  model,
  simpleChatMode,
  showReasoning,
}: MessageRowProps) {
  const messageTextContent = getMessageText(message)
  const streaming = message.type === 'assistant' && message.time.completed === undefined
  const isEditingThisMessage = editingUserMessageId === message.id
  const canEditUserMessage = isLastUserMessage && !isSessionBusy
  const canUndoUserMessage = isLastUserMessage && !isSessionBusy && onUndoMessage

  if (message.type === 'user') {
    if (!hasRenderableContent(message, simpleChatMode, showReasoning)) return null

    return (
      <div className="flex flex-col group">
        <div
          className={`w-full rounded-lg p-1.5 ${
            isEditingThisMessage
              ? 'bg-blue-600/30 border border-blue-600/50'
              : 'bg-blue-600/20 border border-blue-600/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">You</span>
              <span className="text-xs text-muted-foreground">
                {new Date(message.time.created).toLocaleTimeString()}
              </span>
              {canEditUserMessage && nextAssistantMessageId && (
                <button
                  onClick={() => handleStartEditUserMessage(message.id, nextAssistantMessageId)}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit message"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {canUndoUserMessage && (
              <UserMessageActionButtons
                sessionId={sessionID}
                directory={directory}
                userMessageId={message.id}
                userMessageContent={messageTextContent}
                onUndo={onUndoMessage}
              />
            )}
          </div>

          {isEditingThisMessage && nextAssistantMessageId ? (
            <EditableUserMessage
              sessionId={sessionID}
              directory={directory}
              content={messageTextContent}
              assistantMessageId={nextAssistantMessageId}
              onCancel={handleCancelEdit}
              model={model}
            />
          ) : simpleChatMode ? (
            <ClickableUserMessage
              content={messageTextContent}
              onClick={() => {}}
              isEditable={false}
            />
          ) : (
            <ClickableUserMessage
              content={messageTextContent}
              onClick={() => handleStartEditUserMessage(message.id, nextAssistantMessageId ?? '')}
              isEditable={false}
            />
          )}

          <UserAttachments
            files={message.files}
            agents={message.agents}
            skills={message.skills}
          />
        </div>
      </div>
    )
  }

  if (message.type === 'assistant') {
    const hasError = message.error !== undefined
    if (!hasRenderableContent(message, simpleChatMode, showReasoning) && !hasError && !message.retry) {
      return null
    }

    const standaloneSubAgentMessage = isStandaloneSubAgentMessage(message)

    if (standaloneSubAgentMessage) {
      return (
        <div className="flex flex-col group">
          <div className="space-y-1">
            {message.content.filter(isSubagentTool).map((part, partIndex) => (
              <div key={`${message.id}-${part.id}-${partIndex}`}>
                <MessagePart
                  part={part}
                  onFileClick={onFileClick}
                  onChildSessionClick={onChildSessionClick}
                />
              </div>
            ))}
          </div>
        </div>
      )
    }

    const isFree = (message.cost ?? 0) === 0
    const totalTokens = message.tokens
      ? message.tokens.input + message.tokens.output + message.tokens.reasoning + message.tokens.cache.read
      : 0

    return (
      <div className="flex flex-col group">
        <div
          className={`w-full rounded-lg p-1.5 bg-card/50 border border-border ${streaming ? 'animate-pulse-subtle' : ''}`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {message.model.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(message.time.created).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {message.content.map((part, partIndex) => (
              <div key={`${message.id}-${part.type}-${partIndex}`}>
                <MessagePart
                  part={part}
                  onFileClick={onFileClick}
                  onChildSessionClick={onChildSessionClick}
                />
              </div>
            ))}
            {!simpleChatMode && message.snapshot?.files && (
              <StepFileChanges
                files={message.snapshot.files}
                snapshot={message.snapshot.end}
                onFileClick={onFileClick}
              />
            )}
            {message.retry && <RetryPart retry={message.retry} />}
            {message.error && <MessageError error={message.error} />}
          </div>

          <div className="text-xs text-muted-foreground my-1 flex items-center gap-2">
            {!(isFree) && <span>${(message.cost ?? 0).toFixed(4)} • {totalTokens} tokens</span>}
            <CopyButton content={messageTextContent} title="Copy message" />
            {messageTextContent && <TTSButton messageId={message.id} content={messageTextContent} />}
          </div>
        </div>
      </div>
    )
  }

  if (message.type === 'shell') {
    return <ShellMessage message={message} />
  }

  if (message.type === 'compaction') {
    return <CompactionBanner message={message} />
  }

  if (message.type === 'agent-switched') {
    return <MessageDivider label={`Agent: ${message.agent}`} />
  }

  if (message.type === 'model-switched') {
    return <MessageDivider label={`Model: ${message.model.providerID}/${message.model.id}`} />
  }

  if (message.type === 'location-switched') {
    return <MessageDivider label={`Location: ${message.location.directory}`} />
  }

  if (message.type === 'skill') {
    return (
      <div className="my-1 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-xs text-muted-foreground">
        Skill loaded: <span className="font-medium text-foreground">{message.name}</span>
      </div>
    )
  }

  if (message.type === 'synthetic' || message.type === 'system') {
    return (
      <div className="my-1 px-3 py-1.5 text-xs italic text-muted-foreground whitespace-pre-wrap">
        {message.text}
      </div>
    )
  }

  return null
})

interface MessageThreadProps {
  sessionID: string
  directory?: string
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  onUndoMessage?: (restoredPrompt: string) => void
  model?: string
  isSessionBusy?: boolean
}

export const MessageThread = memo(function MessageThread({
  sessionID,
  directory,
  messages,
  pending,
  onFileClick,
  onChildSessionClick,
  onUndoMessage,
  model,
  isSessionBusy = false,
}: MessageThreadProps) {
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null)
  const { preferences } = useSettings()
  const simpleChatMode = preferences?.simpleChatMode ?? false
  const showReasoning = preferences?.showReasoning ?? false

  const lastUserMessageId = useMemo(() => findLastUserMessageId(messages), [messages])

  const nextAssistantIdByMessageId = useMemo(() => {
    const map = new Map<string, string | undefined>()
    let nextAssistantId: string | undefined
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      map.set(message.id, nextAssistantId)
      if (message.type === 'assistant') {
        nextAssistantId = message.id
      }
    }
    return map
  }, [messages])

  const handleStartEditUserMessage = useCallback((userMessageId: string) => {
    setEditingUserMessageId(userMessageId)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingUserMessageId(null)
  }, [])

  if (messages.length === 0 && pending.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No messages yet. Start a conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col space-y-2 p-2 overflow-x-hidden">
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          nextAssistantMessageId={nextAssistantIdByMessageId.get(message.id)}
          isLastUserMessage={message.id === lastUserMessageId}
          isSessionBusy={isSessionBusy}
          onUndoMessage={onUndoMessage}
          editingUserMessageId={editingUserMessageId}
          handleStartEditUserMessage={handleStartEditUserMessage}
          handleCancelEdit={handleCancelEdit}
          sessionID={sessionID}
          directory={directory}
          onFileClick={onFileClick}
          onChildSessionClick={onChildSessionClick}
          model={model}
          simpleChatMode={simpleChatMode}
          showReasoning={showReasoning}
        />
      ))}
      {pending.map((item) => (
        item.type === 'user'
          ? <QueuedPromptRow key={item.id} item={item} />
          : null
      ))}
    </div>
  )
})
