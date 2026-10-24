import { useState, useRef, useEffect, useMemo, useImperativeHandle, forwardRef, memo, useCallback, type KeyboardEvent } from 'react'
import { useSendPrompt, useInterruptSession, useSendShell, useAgents, useSkills } from '@/hooks/useOpenCode'
import { useCommands } from '@/hooks/useCommands'
import { useCommandHandler } from '@/hooks/useCommandHandler'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { useSessionAgent } from '@/hooks/useSessionAgent'
import { useSttAvailability } from '@/hooks/useSTT'

import { useUserBash } from '@/stores/userBashStore'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { useComposerDraftStore, type ComposerDraft } from '@/stores/composerDraftStore'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'
import { useHasBackgroundActivity, useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { useTouchTapSelect } from '@/hooks/useTouchTapSelect'
import { useMobile } from '@/hooks/useMobile'
import { FINE_POINTER_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'

import { usePermissions } from '@/contexts/EventContext'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { Upload, X, Mic, Target } from 'lucide-react'

import { SquareFill } from '@/components/ui/square-fill'
import { IconToggleButton } from '@/components/ui/icon-toggle-button'

import { PromptSuggestions, type PromptSuggestion } from './PromptSuggestions'
import { ComposerActivityBar } from './ComposerActivityBar'
import { AgentQuickSelect } from '@/components/agent/AgentQuickSelect'
import { VoiceConversation, type VoiceConversationHandle } from './VoiceConversation'
import { PermissionModeToggle } from '@/components/session/PermissionModeToggle'
import { SessionSandboxMenu } from '@/components/session/SessionSandboxMenu'
import { ComposerModelPill } from './ComposerModelPill'
import { ComposerToolsMenu } from './ComposerToolsMenu'
import { useSessionGoal, useStartSessionGoal } from '@/hooks/useSessionGoals'
import { useSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import { detectMentionTrigger, parsePromptToInput, getFilename, getDirectory, type MentionItem } from '@/lib/promptParser'
import { matchText, rankByMatch, type MatchRange } from '@/lib/fuzzyMatch'
import { getNextPrimaryAgentId } from '@/lib/primaryAgents'
import { getNextFavoriteModel } from '@/lib/favoriteModels'
import { randomId } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { findModelInfo, isSameModelSelection } from '@opencode-manager/shared/opencode'
import { isOpenSessionGoal } from '@opencode-manager/shared/schemas'
import { useProviders } from '@/hooks/useProviders'


import type { CommandInfo } from '@opencode-manager/shared/opencode'
import type { FileAttachmentInfo, ImageAttachment } from '@/api/types'
import { isBuiltinCommand, type CommandActions, type PageCommandActions } from '@/lib/builtinCommands'

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif"]

function parseCommandPrompt(value: string): { name: string; args?: string } | null {
  const match = value.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/)
  return match ? { name: match[1], args: match[2] } : null
}


const revokeBlobUrls = (attachments: ImageAttachment[]) => {
  attachments.forEach((attachment) => {
    if (attachment.dataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.dataUrl)
    }
  })
}

const runAfterSend = async (send: Promise<unknown>, onSent: () => void, onFailed?: () => void) => {
  try {
    await send
  } catch {
    onFailed?.()
    return
  }
  onSent()
}

const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]

const COMMAND_TRIGGER_PATTERN = /(^|\s)\/([a-zA-Z0-9_-]*)$/
const FILE_FALLBACK_MATCH_TIER = 4
const KEYBAR_HIDE_DELAY_MS = 250

type KeybarKey = 'command' | 'mention' | 'bash'
type ComposerMode = 'command' | 'mention' | 'bash'

const KEYBAR_KEYS: Array<{ id: KeybarKey, symbol: string, label: string }> = [
  { id: 'command', symbol: '/', label: 'cmd' },
  { id: 'mention', symbol: '@', label: 'mention' },
  { id: 'bash', symbol: '!', label: 'bash' },
]

const COMPOSER_MODE_STYLES: Record<ComposerMode, { label: string, frame: string, badge: string, key: string }> = {
  command: {
    label: 'COMMAND',
    frame: 'border-primary/70 ring-1 ring-primary/40 shadow-lg shadow-primary/20',
    badge: 'bg-primary text-primary-foreground',
    key: 'bg-primary text-primary-foreground border-primary',
  },
  mention: {
    label: 'MENTION',
    frame: 'border-success/70 ring-1 ring-success/40 shadow-lg shadow-success/20',
    badge: 'bg-success text-success-foreground',
    key: 'bg-success text-success-foreground border-success',
  },
  bash: {
    label: 'BASH',
    frame: 'border-warning/70 ring-1 ring-warning/40 shadow-lg shadow-warning/20',
    badge: 'bg-warning text-warning-foreground',
    key: 'bg-warning text-warning-foreground border-warning',
  },
}

const shiftRanges = (ranges: MatchRange[], offset: number): MatchRange[] =>
  ranges.map(([start, end]) => [start + offset, end + offset])


export interface PromptInputHandle {
  setPromptValue: (value: string) => void
  clearPrompt: () => void
  triggerFileUpload: () => void
  openModelPicker: () => void
  cycleAgent: () => void
  cycleVariant: () => void
  cycleFavoriteModel: () => void
}

interface PromptInputProps {
  directory?: string
  sessionID: string
  onVoiceConversationActiveChange?: (active: boolean) => void
  onSuggestionsOpenChange?: (open: boolean) => void
  isSessionActive?: boolean
  isStreamingResponse?: boolean
  onScrollToBottom: () => void
  commandActions: PageCommandActions
  onPromptChange?: (hasContent: boolean) => void
}

export const PromptInput = memo(forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput({ 
  directory,
  sessionID,
  onVoiceConversationActiveChange,
  onSuggestionsOpenChange,
  isSessionActive = false,
  isStreamingResponse = false,
  onScrollToBottom,
  commandActions,
  onPromptChange
}, ref) {
  const [restoredDraft] = useState(() => useComposerDraftStore.getState().getDraft(sessionID))
  const [prompt, setPrompt] = useState(restoredDraft.prompt)
  const [isBashMode, setIsBashMode] = useState(restoredDraft.isBashMode)
  const [isGoalArmed, setIsGoalArmed] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [attachedFiles, setAttachedFiles] = useState(restoredDraft.attachedFiles)
  const [imageAttachments, setImageAttachments] = useState(restoredDraft.imageAttachments)
  const [isDragging, setIsDragging] = useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionRange, setMentionRange] = useState<{ start: number, end: number } | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [localMode, setLocalMode] = useState<string | null>(null)
  const [isPromptFocused, setIsPromptFocused] = useState(false)
  const [isVoiceActive, setIsVoiceActive] = useState(false)
  const voiceRef = useRef<VoiceConversationHandle>(null)
  const promptBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCommandSubmitRef = useRef(false)
  const handleSubmitRef = useRef<() => void>(() => {})
  const promptRef = useRef(prompt)
  const attachedFilesRef = useRef(attachedFiles)
  const imageAttachmentsRef = useRef(imageAttachments)

  const sttAvailability = useSttAvailability()

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasFinePointer = useMediaQuery(FINE_POINTER_MEDIA_QUERY)
  const isMobile = useMobile()

  useEffect(() => {
    if (!hasFinePointer) return
    const activeElement = document.activeElement
    if (activeElement && activeElement !== document.body) return
    textareaRef.current?.focus()
  }, [hasFinePointer, sessionID])

  useEffect(() => {
    promptRef.current = prompt
    attachedFilesRef.current = attachedFiles
    imageAttachmentsRef.current = imageAttachments
  }, [attachedFiles, imageAttachments, prompt])

  const saveDraft = useComposerDraftStore((state) => state.saveDraft)
  const clearDraft = useComposerDraftStore((state) => state.clearDraft)
  const clearDraftIfUnchanged = useComposerDraftStore((state) => state.clearDraftIfUnchanged)

  useEffect(() => {
    if (prompt === '' && !isBashMode && attachedFiles.size === 0 && imageAttachments.length === 0) {
      clearDraft(sessionID)
      return
    }
    saveDraft(sessionID, { prompt, isBashMode, attachedFiles, imageAttachments })
  }, [sessionID, prompt, isBashMode, attachedFiles, imageAttachments, saveDraft, clearDraft])

  const clearSubmittedPrompt = useCallback((submittedPrompt: string, submittedAttachedFiles: Map<string, FileAttachmentInfo>, submittedImageAttachments: ImageAttachment[], options?: { keepAttachments?: boolean }) => {
    if (
      promptRef.current !== submittedPrompt ||
      attachedFilesRef.current !== submittedAttachedFiles ||
      imageAttachmentsRef.current !== submittedImageAttachments
    ) {
      return
    }

    setPrompt('')
    if (!options?.keepAttachments) {
      setAttachedFiles(new Map())
      revokeBlobUrls(submittedImageAttachments)
      setImageAttachments([])
    }
  }, [])

  const completeSubmittedDraft = useCallback((submitted: ComposerDraft, options?: { keepAttachments?: boolean }) => {
    clearDraftIfUnchanged(sessionID, submitted, options)
    clearSubmittedPrompt(submitted.prompt, submitted.attachedFiles, submitted.imageAttachments, options)
  }, [sessionID, clearDraftIfUnchanged, clearSubmittedPrompt])

  const pendingConfirmClearRef = useRef<{
    prompt: string
    files: Map<string, FileAttachmentInfo>
    images: ImageAttachment[]
  } | null>(null)

  useEffect(() => {
    if (!isStreamingResponse) return
    const pending = pendingConfirmClearRef.current
    if (!pending) return
    pendingConfirmClearRef.current = null
    clearSubmittedPrompt(pending.prompt, pending.files, pending.images)
  }, [isStreamingResponse, clearSubmittedPrompt])

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const sessionAgent = useSessionAgent(sessionID, directory)
  const hasBackgroundActivity = useHasBackgroundActivity(sessionID)
  const serverId = useOpenCodeServerId()
  const isLocalServer = isLocalOpenCodeServer(serverId)
  const currentMode = localMode ?? sessionAgent.agent
  const setStoredAgent = useSessionAgentStore((s) => s.setAgent)
  const sendPrompt = useSendPrompt(directory)
  const sendShell = useSendShell(directory)
  const startGoal = useStartSessionGoal()
  const isPromptSubmitPending = sendPrompt.isPending || sendShell.isPending || startGoal.isPending
  const interruptSession = useInterruptSession()
  const { data: sessionGoal } = useSessionGoal(sessionID)
  const { data: permissionMode } = useSessionPermissionMode(sessionID)
  const { searchCommands, findCommand, recentNames } = useCommands({ directory })
  const recordCommand = useRecentCommandsStore((state) => state.recordCommand)
  const isExactCommandPrompt = (value: string) => {
    const commandPrompt = parseCommandPrompt(value)
    return Boolean(commandPrompt && findCommand(commandPrompt.name))
  }
  
  const { files: searchResults } = useFileSearch(
    mentionQuery,
    showMentionSuggestions,
    directory
  )
  
  const { data: agents = [] } = useAgents(directory)
  const { data: skills = [] } = useSkills(directory)
  const mentionableAgents = useMemo(
    () => agents.filter((agent) => !agent.hidden && agent.mode !== 'primary'),
    [agents],
  )
  const agentNames = useMemo(() => agents.map((agent) => agent.name), [agents])
  const skillIds = useMemo(() => skills.map((skill) => skill.id), [skills])
  const failedPrompt = useSendErrorStore((state) => state.errors[sessionID]?.failedPrompt)
  const restoredFailedPromptRef = useRef<string | null>(null)

  useEffect(() => {
    if (failedPrompt) {
      if (restoredFailedPromptRef.current === failedPrompt) return
      restoredFailedPromptRef.current = failedPrompt
      if (promptRef.current) return
      setPrompt(failedPrompt)
      textareaRef.current?.focus()
      return
    }
    if (restoredFailedPromptRef.current !== null) {
      if (promptRef.current === restoredFailedPromptRef.current) {
        setPrompt('')
      }
      restoredFailedPromptRef.current = null
    }
  }, [failedPrompt])
  
  const mentionSuggestions = useMemo((): PromptSuggestion<MentionItem>[] => {
    const agentMatches = rankByMatch(mentionableAgents, mentionQuery, {
      getName: (agent) => agent.name,
      getDescription: (agent) => agent.description,
    }).map(({ item, tier, ranges }) => ({
      tier,
      suggestion: {
        key: `agent-${item.name}`,
        value: { type: 'agent', value: item.name } satisfies MentionItem,
        kind: 'agent' as const,
        label: item.name,
        ranges,
        detail: item.description || 'Agent',
        tag: 'agent',
      },
    }))

    const skillMatches = rankByMatch(skills, mentionQuery, {
      getName: (skill) => skill.id,
      getDescription: (skill) => skill.description,
    }).map(({ item, tier, ranges }) => ({
      tier,
      suggestion: {
        key: `skill-${item.id}`,
        value: { type: 'skill', value: item.id } satisfies MentionItem,
        kind: 'skill' as const,
        label: item.id,
        ranges,
        detail: item.description || item.name,
        tag: 'skill',
      },
    }))

    const fileMatches = searchResults.map((file) => {
      const label = getFilename(file)
      const match = matchText(mentionQuery, label)
      return {
        tier: match?.tier ?? FILE_FALLBACK_MATCH_TIER,
        suggestion: {
          key: `file-${file}`,
          value: { type: 'file', value: file } satisfies MentionItem,
          kind: 'file' as const,
          label,
          ranges: match?.ranges ?? [],
          detail: getDirectory(file),
          tag: 'file',
        },
      }
    })

    return [...agentMatches, ...skillMatches, ...fileMatches]
      .sort((a, b) => a.tier - b.tier)
      .map(({ suggestion }) => suggestion)
  }, [mentionableAgents, skills, searchResults, mentionQuery])

  const commandSuggestions = useMemo((): PromptSuggestion<CommandInfo>[] =>
    searchCommands(suggestionQuery).map(({ item, ranges }) => ({
      key: item.name,
      value: item,
      kind: 'command',
      label: `/${item.name}`,
      ranges: shiftRanges(ranges, 1),
      detail: item.description,
      tag: !suggestionQuery && recentNames.includes(item.name) ? 'recent' : undefined,
    })),
  [searchCommands, suggestionQuery, recentNames])
  

  const addUserBashCommand = useUserBash((s) => s.addUserBashCommand)

  const startArmedGoal = async (objective: string): Promise<boolean> => {
    if (!directory || !objective.trim()) return true
    try {
      await startGoal.mutateAsync({ sessionId: sessionID, directory, objective })
    } catch {
      return false
    }
    setIsGoalArmed(false)
    return true
  }

  const handleSubmit = async () => {
    if (!isModelReady) return
    if (!prompt.trim() && imageAttachments.length === 0) return
    if (startGoal.isPending) return

    if (isStreamingResponse) {
      onScrollToBottom()
      const parsed = parsePromptToInput(prompt, attachedFiles, agentNames, skillIds, imageAttachments)
      const submitted: ComposerDraft = { prompt, isBashMode, attachedFiles, imageAttachments }
      if (isGoalArmed && !isBashMode && !isExactCommandPrompt(prompt)) {
        const goalStarted = await startArmedGoal(parsed.text)
        if (!goalStarted) return
      }
      void runAfterSend(
        sendPrompt.mutateAsync({
          sessionID,
          text: parsed.text,
          files: parsed.files,
          agents: parsed.agents,
          skills: parsed.skills,
          model: modelRef ?? undefined,
          agent: currentMode,
          delivery: 'queue',
        }),
        () => completeSubmittedDraft(submitted),
      )
      setStoredAgent(sessionID, currentMode)
      return
    }

    if (isPromptSubmitPending) return

    if (isBashMode) {
      const command = prompt.startsWith('!') ? prompt.slice(1) : prompt
      addUserBashCommand(command)
      const submitted: ComposerDraft = { prompt, isBashMode, attachedFiles, imageAttachments }
      void runAfterSend(
        sendShell.mutateAsync({ sessionID, command }),
        () => {
          clearDraftIfUnchanged(sessionID, submitted, { keepAttachments: true })
          if (promptRef.current !== submitted.prompt) return
          setPrompt('')
          setIsBashMode(false)
        },
      )
      setStoredAgent(sessionID, currentMode)
      return
    }

    

    const commandPrompt = parseCommandPrompt(prompt)
    if (commandPrompt) {
      const command = findCommand(commandPrompt.name)
      
      if (command) {
        recordCommand(command.name)
        const parsed = parsePromptToInput(commandPrompt.args?.trim() || '', attachedFiles, agentNames, skillIds, imageAttachments)
        const submitted: ComposerDraft = { prompt, isBashMode, attachedFiles, imageAttachments }

        void executeCommand(command, {
          text: parsed.text,
          files: parsed.files,
          agents: parsed.agents,
          skills: parsed.skills,
        }).then((shouldClear) => {
          if (!shouldClear) return
          const keepAttachments = isBuiltinCommand(command) && (submitted.attachedFiles.size > 0 || submitted.imageAttachments.length > 0)
          if (keepAttachments) {
            completeSubmittedDraft(submitted, { keepAttachments: true })
            showToast.info('Built-in commands do not use attachments; they were kept')
            return
          }
          completeSubmittedDraft(submitted)
        })
        return
      }
    }

    const parsed = parsePromptToInput(prompt, attachedFiles, agentNames, skillIds, imageAttachments)
    const submitted: ComposerDraft = { prompt, isBashMode, attachedFiles, imageAttachments }

    if (isGoalArmed) {
      const goalStarted = await startArmedGoal(parsed.text)
      if (!goalStarted) return
    }

    pendingConfirmClearRef.current = {
      prompt: submitted.prompt,
      files: submitted.attachedFiles,
      images: submitted.imageAttachments
    }

    void runAfterSend(
      sendPrompt.mutateAsync({
        sessionID,
        text: parsed.text,
        files: parsed.files,
        agents: parsed.agents,
        skills: parsed.skills,
        model: modelRef ?? undefined,
        agent: currentMode,
      }),
      () => {
        pendingConfirmClearRef.current = null
        completeSubmittedDraft(submitted)
      },
      () => {
        pendingConfirmClearRef.current = null
      },
    )

    onScrollToBottom()

    setStoredAgent(sessionID, currentMode)
  }

  handleSubmitRef.current = handleSubmit

  const interruptTurn = useCallback(
    (): Promise<void> =>
      new Promise((resolve) => {
        interruptSession.mutate(sessionID, { onSettled: () => resolve() })
      }),
    [interruptSession, sessionID],
  )

  const handleStop = () => {
    void interruptTurn()
  }

  const focusPromptAt = useCallback((cursorPosition: number) => {
    setTimeout(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(cursorPosition, cursorPosition)
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }, 0)
  }, [])

  const handleCommandSelect = useCallback((command: CommandInfo, submitAfterInsert = false) => {
    if (!textareaRef.current) return

    setShowSuggestions(false)
    setSuggestionQuery('')

    const cursorPosition = textareaRef.current.selectionStart
    const commandMatch = prompt.slice(0, cursorPosition).match(COMMAND_TRIGGER_PATTERN)

    const beforeCommand = commandMatch ? prompt.slice(0, (commandMatch.index ?? 0) + commandMatch[1].length) : ''
    const afterCommand = commandMatch ? prompt.slice(cursorPosition) : ''
    const newPrompt = beforeCommand + '/' + command.name + ' ' + afterCommand

    if (submitAfterInsert && newPrompt === prompt) {
      handleSubmitRef.current()
      return
    }

    pendingCommandSubmitRef.current = submitAfterInsert
    setPrompt(newPrompt)
    if (!submitAfterInsert) focusPromptAt(beforeCommand.length + command.name.length + 2)
  }, [prompt, focusPromptAt])

  const handleCommandSwipe = useCallback((command: CommandInfo) => {
    handleCommandSelect(command, true)
  }, [handleCommandSelect])

  useEffect(() => {
    if (!pendingCommandSubmitRef.current) return
    pendingCommandSubmitRef.current = false
    handleSubmitRef.current()
  }, [prompt])

  const insertFileMention = useCallback((filePath: string, range: { start: number, end: number }) => {
    const filename = getFilename(filePath)
    const beforeMention = prompt.slice(0, range.start)
    const afterMention = prompt.slice(range.end)
    const newPrompt = beforeMention + '@' + filename + ' ' + afterMention

    setPrompt(newPrompt)

    const absolutePath = filePath.startsWith('/')
      ? filePath
      : directory
        ? `${directory}/${filePath}`
        : filePath

    setAttachedFiles(prev => {
      const next = new Map(prev)
      next.set(filename.toLowerCase(), {
        path: absolutePath,
        name: filename
      })
      return next
    })

    focusPromptAt(beforeMention.length + filename.length + 2)
  }, [directory, prompt, focusPromptAt])

  const handleMentionSelect = (item: MentionItem) => {
    if (!mentionRange || !textareaRef.current) return
    
    const beforeMention = prompt.slice(0, mentionRange.start)
    const afterMention = prompt.slice(mentionRange.end)
    
    if (item.type === 'file') {
      insertFileMention(item.value, mentionRange)
    } else {
      setPrompt(beforeMention + '@' + item.value + ' ' + afterMention)
      focusPromptAt(beforeMention.length + item.value.length + 2)
    }
    
    setShowMentionSuggestions(false)
    setMentionQuery('')
    setMentionRange(null)
  }

  const addImageAttachment = (file: File) => {
    try {
      const reader = new FileReader()
      
      reader.onloadend = () => {
        try {
          if (reader.readyState !== 2) return
          
          const dataUrl = reader.result as string
          
          if (!dataUrl) {
            const blobUrl = URL.createObjectURL(file)
            const attachment: ImageAttachment = {
              id: randomId(),
              filename: file.name,
              mime: file.type || 'image/png',
              dataUrl: blobUrl,
            }
            setImageAttachments((prev) => [...prev, attachment])
            return
          }
          
          const attachment: ImageAttachment = {
            id: randomId(),
            filename: file.name,
            mime: file.type || 'image/png',
            dataUrl,
          }
          setImageAttachments((prev) => [...prev, attachment])
        } catch (innerError) {
          console.error('Error inside onloadend:', innerError)
        }
      }
      
      reader.onerror = () => {
        console.error('FileReader error:', reader.error?.message)
      }
      
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Error reading file:', error)
    }
  }

  const removeImageAttachment = (id: string) => {
    setImageAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id)
      if (attachment?.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.dataUrl)
      }
      return prev.filter((a) => a.id !== id)
    })
  }

  const addFileAttachment = (file: File) => {
    if (ACCEPTED_FILE_TYPES.includes(file.type)) {
      addImageAttachment(file)
    } else {
      showToast.error(`Only images and PDFs can be attached (${file.name})`)
    }
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as { MSStream?: boolean }).MSStream
    const isSecureContext = window.isSecureContext || (window.location.protocol === 'http:' && window.location.hostname === 'localhost')

if (isIOS && isSecureContext && navigator.clipboard && navigator.clipboard.read) {
      try {
        const text = await navigator.clipboard.readText()
        if (text && text.trim()) {
          return
        }
      } catch {
      }

      event.preventDefault()

      try {
        const clipboardItems = await navigator.clipboard.read()

        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (ACCEPTED_FILE_TYPES.includes(type) || type.startsWith('image/')) {
              try {
                const blob = await item.getType(type)
                const file = new File([blob], `pasted-${Date.now()}.${type.split('/')[1]}`, { type })
                addFileAttachment(file)
              } catch (err) {
                console.error('Failed to read clipboard item type:', err)
              }
            }
          }
        }
        return
      } catch (error) {
        console.error('Clipboard read failed on iOS:', error)
      }
    }

    const items = Array.from(clipboardData.items)

    const fileItems = items.filter((item) => item.kind === 'file')

    if (fileItems.length > 0) {
      event.preventDefault()
      for (const item of fileItems) {
        const file = item.getAsFile()
        if (file) {
          addFileAttachment(file)
        }
      }
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer?.types.includes('Files')) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (event: React.DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (event: React.DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const files = event.dataTransfer?.files
    if (files) {
      for (const file of Array.from(files)) {
        addFileAttachment(file)
      }
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file) {
      addFileAttachment(file)
    }
    event.currentTarget.value = ''
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isBashMode && e.key === 'Escape') {
      e.preventDefault()
      if (prompt === '!' || prompt === '') {
        setIsBashMode(false)
        setPrompt('')
      }
      return
    }

    const suggestionStep = isMobile ? -1 : 1

    if (showMentionSuggestions && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex(prev => {
          const next = prev + suggestionStep
          return next >= 0 && next < mentionSuggestions.length ? next : prev
        })
        return
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex(prev => {
          const next = prev - suggestionStep
          return next >= 0 && next < mentionSuggestions.length ? next : prev
        })
        return
      }
      
      if (e.key === 'Enter') {
        e.preventDefault()
        const selectedMention = mentionSuggestions[selectedMentionIndex]
        if (selectedMention) {
          handleMentionSelect(selectedMention.value)
        }
        return
      }
      
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionSuggestions(false)
        setMentionQuery('')
        setMentionRange(null)
        return
      }
    }
    
    if (showSuggestions) {
      if (e.key === 'ArrowDown' && commandSuggestions.length > 0) {
        e.preventDefault()
        setSelectedCommandIndex(prev => (prev + suggestionStep + commandSuggestions.length) % commandSuggestions.length)
        return
      }
      
      if (e.key === 'ArrowUp' && commandSuggestions.length > 0) {
        e.preventDefault()
        setSelectedCommandIndex(prev => (prev - suggestionStep + commandSuggestions.length) % commandSuggestions.length)
        return
      }
      
      if (e.key === 'Enter') {
        e.preventDefault()
        const selectedCommand = commandSuggestions[selectedCommandIndex]
        if (selectedCommand) {
          handleCommandSelect(selectedCommand.value)
        }
        return
      }
      
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
        setSuggestionQuery('')
        setSelectedCommandIndex(0)
        return
      }
    }
    
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey || (!e.shiftKey && (isMobile || isExactCommandPrompt(prompt))))) {
      e.preventDefault()
      if (isMobile) {
        textareaRef.current?.blur()
      }
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    
    if (value === '!' && prompt === '') {
      setIsBashMode(true)
      setPrompt(value)
      return
    }
    
    if (isBashMode && value === '') {
      setIsBashMode(false)
    }
    
    setPrompt(value)

    if (isBashMode) {
      return
    }

    updateSuggestionTriggers(value, e.target.selectionStart)
  }

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false)
    setSuggestionQuery('')
    setShowMentionSuggestions(false)
    setMentionQuery('')
    setMentionRange(null)
  }, [])

  const resetPrompt = useCallback(() => {
    setPrompt('')
    setAttachedFiles(new Map())
    revokeBlobUrls(imageAttachments)
    setImageAttachments([])
    closeSuggestions()
    setIsBashMode(false)
  }, [imageAttachments, closeSuggestions])

  const updateSuggestionTriggers = (value: string, cursorPosition: number) => {
    const mentionTrigger = detectMentionTrigger(value, cursorPosition)
    
    if (mentionTrigger) {
      setMentionQuery(mentionTrigger.query)
      setMentionRange({ start: mentionTrigger.start, end: mentionTrigger.end })
      setShowMentionSuggestions(true)
      setSelectedMentionIndex(0)
      return
    }

    const commandMatch = value.slice(0, cursorPosition).match(COMMAND_TRIGGER_PATTERN)
    
    if (commandMatch) {
      setSuggestionQuery(commandMatch[2])
      setShowSuggestions(true)
      setSelectedCommandIndex(0)
    } else {
      setShowSuggestions(false)
      setSuggestionQuery('')
    }
    
    if (showMentionSuggestions) {
      setShowMentionSuggestions(false)
      setMentionQuery('')
      setMentionRange(null)
    }
  }

  const insertTriggerAtCursor = (trigger: '/' | '@') => {
    const selectionStart = textareaRef.current?.selectionStart ?? prompt.length
    const selectionEnd = textareaRef.current?.selectionEnd ?? prompt.length
    const before = prompt.slice(0, selectionStart)
    const separator = before && !/\s$/.test(before) ? ' ' : ''
    const nextPrompt = `${before}${separator}${trigger}${prompt.slice(selectionEnd)}`
    const cursorPosition = before.length + separator.length + 1

    setPrompt(nextPrompt)
    updateSuggestionTriggers(nextPrompt, cursorPosition)
    focusPromptAt(cursorPosition)
  }

  const removeActiveTrigger = () => {
    const cursorPosition = textareaRef.current?.selectionStart ?? prompt.length
    const commandTokenStart = prompt.slice(0, cursorPosition).search(/\/[a-zA-Z0-9_-]*$/)
    const tokenStart = showMentionSuggestions && mentionRange ? mentionRange.start : commandTokenStart
    const start = tokenStart >= 0 ? tokenStart : cursorPosition

    setPrompt(prompt.slice(0, start) + prompt.slice(cursorPosition))
    closeSuggestions()
    focusPromptAt(start)
  }

  const toggleBashMode = () => {
    closeSuggestions()
    if (isBashMode) {
      const nextPrompt = prompt.replace(/^!/, '')
      setIsBashMode(false)
      setPrompt(nextPrompt)
      focusPromptAt(nextPrompt.length)
      return
    }
    setIsBashMode(true)
    setPrompt('!')
    focusPromptAt(1)
  }

  const isBashKeyEnabled = isBashMode || (prompt === '' && imageAttachments.length === 0)

  const handleKeybarKey = (key: KeybarKey) => {
    if (key === 'bash') {
      if (isBashKeyEnabled) toggleBashMode()
      return
    }
    if (isBashMode) return
    const isActive = key === 'command' ? showSuggestions : showMentionSuggestions
    if (isActive) {
      removeActiveTrigger()
      return
    }
    insertTriggerAtCursor(key === 'command' ? '/' : '@')
  }

  const keybarTouch = useTouchTapSelect(handleKeybarKey)

  const clearPromptBlurTimer = useCallback(() => {
    if (promptBlurTimerRef.current) clearTimeout(promptBlurTimerRef.current)
    promptBlurTimerRef.current = null
  }, [])

  useEffect(() => clearPromptBlurTimer, [clearPromptBlurTimer])

  const handlePromptFocus = () => {
    clearPromptBlurTimer()
    setIsPromptFocused(true)
  }

  const handlePromptBlur = () => {
    clearPromptBlurTimer()
    promptBlurTimerRef.current = setTimeout(() => setIsPromptFocused(false), KEYBAR_HIDE_DELAY_MS)
  }

  const { data: providersData } = useProviders(directory)

  const modelSelectionSession = useMemo(
    () => (sessionID
      ? { id: sessionID, agent: sessionAgent.sessionAgentId, model: sessionAgent.modelRef }
      : undefined),
    [sessionID, sessionAgent.sessionAgentId, sessionAgent.modelRef],
  )

  const { model, modelString, modelRef, favoriteModels, setModel, setActiveAgent, isModelReady } = useModelSelection(directory, modelSelectionSession)

  useEffect(() => {
    setActiveAgent({
      id: currentMode,
      model: agents.find((agent) => agent.id === currentMode)?.model,
    })
  }, [agents, currentMode, setActiveAgent])

  const currentModel = modelString || ''
  const displayModelName = useMemo(() => {
    if (!model) {
      return currentModel
    }

    const info = findModelInfo(providersData?.models ?? [], model)

    return info?.name || model.modelID || currentModel
  }, [currentModel, model, providersData])
  const { setShowDialog, hasForSession: hasPermissionsForSession } = usePermissions()
  const hasPendingPermissionForSession = hasPermissionsForSession(sessionID)
  const { hasVariants, currentVariant, cycleVariant } = useVariants(directory, modelSelectionSession)
  const isCompacting = useSessionStatusForSession(sessionID).type === 'compact'
  const modelPillVariant = hasVariants && currentVariant ? currentVariant : null
  const handleCompact = useCallback(() => commandActions.compact(''), [commandActions])

  const handleAgentChange = useCallback((agentId: string) => {
    setLocalMode(agentId)
    setStoredAgent(sessionID, agentId)
  }, [sessionID, setStoredAgent])

  const handleCycleVariant = useCallback(() => {
    if (!hasVariants) {
      showToast.info('The selected model has no variants')
      return
    }
    cycleVariant()
  }, [hasVariants, cycleVariant])

  const handleCycleFavoriteModel = useCallback(() => {
    const next = getNextFavoriteModel(favoriteModels, model)
    if (!next) {
      showToast.info('No favorite models')
      return
    }
    if (model && isSameModelSelection(model, next)) {
      return
    }
    setModel(next)
  }, [favoriteModels, model, setModel])

  const handleCycleAgent = useCallback(() => {
    const next = getNextPrimaryAgentId(agents, currentMode)
    if (!next) {
      showToast.info('No primary agents available')
      return
    }
    handleAgentChange(next)
  }, [agents, currentMode, handleAgentChange])

  useImperativeHandle(ref, () => ({
    setPromptValue: (value: string) => {
      setPrompt(value)
      textareaRef.current?.focus()
    },
    clearPrompt: () => {
      resetPrompt()
      textareaRef.current?.focus()
    },
    triggerFileUpload: openFilePicker,
    openModelPicker: () => {
      setIsModelPickerOpen(true)
    },
    cycleAgent: handleCycleAgent,
    cycleVariant: handleCycleVariant,
    cycleFavoriteModel: handleCycleFavoriteModel,
  }), [resetPrompt, openFilePicker, handleCycleAgent, handleCycleVariant, handleCycleFavoriteModel])

  const commandActionsWithPrompt = useMemo<CommandActions>(
    () => ({
      ...commandActions,
      cycleAgent: handleCycleAgent,
      cycleVariant: handleCycleVariant,
    }),
    [commandActions, handleCycleAgent, handleCycleVariant],
  )

  const { executeCommand } = useCommandHandler({
    sessionID,
    directory,
    model: modelRef ?? undefined,
    currentAgent: currentMode,
    actions: commandActionsWithPrompt,
  })
  const isCommandListOpen = showSuggestions && commandSuggestions.length > 0
  const isMentionListOpen = showMentionSuggestions && mentionSuggestions.length > 0
  const isSuggestionListOpen = isCommandListOpen || isMentionListOpen

  useEffect(() => {
    onSuggestionsOpenChange?.(isSuggestionListOpen)
  }, [isSuggestionListOpen, onSuggestionsOpenChange])

  const composerMode: ComposerMode | null = isBashMode
    ? 'bash'
    : isMentionListOpen
      ? 'mention'
      : isCommandListOpen || isExactCommandPrompt(prompt)
        ? 'command'
        : null
  const composerModeStyle = composerMode ? COMPOSER_MODE_STYLES[composerMode] : null
  const isTakeoverOpen = isMobile && isSuggestionListOpen
  const showStopButton = isSessionActive
  const hasOpenGoal = isOpenSessionGoal(sessionGoal)
  const lockedReason = permissionMode?.lockedReason ?? null
  const goalButtonLabel = lockedReason === 'schedule'
    ? 'Scheduled runs cannot run goals'
    : lockedReason === 'child'
      ? 'Goals can only be started on top-level sessions'
      : hasOpenGoal
        ? 'A goal is already active for this session'
        : isGoalArmed
          ? 'Goal mode armed: the next message becomes the objective'
          : 'Goal mode: the next message becomes the objective'
  const isGoalModeDisabled = lockedReason !== null || hasOpenGoal || isBashMode || startGoal.isPending
  const toggleGoalArmed = () => setIsGoalArmed((value) => !value)

  const sendVoiceTurn = useCallback(
    async (text: string, options: { busy: boolean }): Promise<void> => {
      await sendPrompt.mutateAsync({
        sessionID,
        text,
        model: modelRef ?? undefined,
        agent: currentMode,
        ...(options.busy ? { delivery: 'queue' as const } : {}),
      })
      setStoredAgent(sessionID, currentMode)
    },
    [currentMode, modelRef, sendPrompt, sessionID, setStoredAgent],
  )

  const handleVoiceEditInTextBox = useCallback((text: string) => {
    const dictated = text.trim()
    if (!dictated) return
    const current = promptRef.current
    const next = current.trim() ? `${current} ${dictated}` : dictated
    setPrompt(next)
    focusPromptAt(next.length)
  }, [focusPromptAt])

  const handleVoiceActiveChange = useCallback((active: boolean) => {
    setIsVoiceActive(active)
    onVoiceConversationActiveChange?.(active)
  }, [onVoiceConversationActiveChange])

  const handleViewApproval = useCallback(() => {
    setShowDialog(true)
  }, [setShowDialog])

  const hasPromptContent = prompt.trim().length > 0 || imageAttachments.length > 0
  const showVoiceMic = sttAvailability.isEnabled && sttAvailability.isSupported && !hasPendingPermissionForSession
  const showMobileKeys = isMobile && isPromptFocused && !hasPendingPermissionForSession

  const renderVoiceMic = () => (
    <button
      type="button"
      aria-label="Start voice conversation"
      title="Start voice conversation"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        textareaRef.current?.blur()
        voiceRef.current?.start()
      }}
      className={isMobile
        ? 'min-h-11 min-w-11 px-0 rounded-lg transition-all duration-150 flex items-center justify-center border bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border-border active:bg-muted-foreground/30 active:scale-95'
        : 'p-2 rounded-lg transition-all duration-200 active:scale-95 hover:scale-105 shadow-md border flex items-center justify-center bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border-border'}
    >
      <Mic className={isMobile ? 'w-6 h-6' : 'w-5 h-5'} />
    </button>
  )

  const renderMobileKeys = () => (
    <div role="toolbar" aria-label="Insert" className="flex flex-nowrap items-center gap-1.5 min-w-0">
      {KEYBAR_KEYS.map((key) => {
        const isActive = key.id === 'command'
          ? showSuggestions
          : key.id === 'mention'
            ? showMentionSuggestions
            : isBashMode
        const isDisabled = key.id === 'bash' ? !isBashKeyEnabled : isBashMode
        return (
          <button
            key={key.id}
            type="button"
            aria-pressed={isActive}
            aria-label={`${key.label} ${key.symbol}`}
            disabled={isDisabled}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={keybarTouch.onTouchStart}
            onTouchMove={keybarTouch.onTouchMove}
            onTouchEnd={(e) => keybarTouch.onTouchEnd(e, key.id)}
            onClick={() => keybarTouch.onClick(key.id)}
            className={`flex items-center gap-1 min-w-0 rounded-lg border font-mono text-base font-bold transition-colors disabled:opacity-30 min-h-9 px-2 ${
              isActive ? COMPOSER_MODE_STYLES[key.id].key : 'bg-muted border-border text-foreground active:bg-muted-foreground/20'
            }`}
          >
            {key.symbol}
            <span className="truncate font-sans text-[11px] font-medium opacity-80">{key.label}</span>
          </button>
        )
      })}
    </div>
  )

  

  

  

  useEffect(() => {
    onPromptChange?.(prompt.trim().length > 0)
  }, [prompt, onPromptChange])

  useEffect(() => {
    setLocalMode(null)
    setIsGoalArmed(false)
  }, [sessionID])

  

  

  const sessionActivityAnnouncement = isSessionActive
    ? 'Session working'
    : hasBackgroundActivity
      ? 'Background tasks running'
      : ''

return (
    <div className={`relative isolate border-t md:border border-border dark:border-border/30 rounded-t-xl md:rounded-xl p-2 pb-7 md:p-3 md:mb-3 w-full before:pointer-events-none before:absolute before:-inset-px before:-z-10 before:rounded-t-xl md:before:rounded-xl before:bg-background md:before:bg-background/95 before:backdrop-blur-md before:content-[''] ${hasPendingPermissionForSession ? 'border-highlight/50 ring-1 ring-highlight/30' : composerModeStyle?.frame ?? ''} ${isTakeoverOpen ? 'z-[60]' : ''}`}>
      <div role="status" aria-live="polite" className="sr-only">
        {sessionActivityAnnouncement}
      </div>
      {composerModeStyle && (
        <span
          data-testid="composer-mode-badge"
          className={`absolute -top-2.5 left-3 z-10 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-widest pointer-events-none ${composerModeStyle.badge}`}
        >
          {composerModeStyle.label}
        </span>
      )}
      <VoiceConversation
        ref={voiceRef}
        sessionID={sessionID}
        serverId={serverId}
        hasPendingApproval={hasPendingPermissionForSession}
        sendTurn={sendVoiceTurn}
        interrupt={interruptTurn}
        onEditInTextBox={handleVoiceEditInTextBox}
        onViewApproval={handleViewApproval}
        onActiveChange={handleVoiceActiveChange}
      />

      {!isVoiceActive && (
        <>
      <div className="flex items-end gap-1.5 md:gap-2 mb-1.5 md:mb-2">
        <textarea
          ref={textareaRef}
          data-prompt-input
          value={prompt}
          onChange={handleInput}
          onFocus={handlePromptFocus}
          onBlur={handlePromptBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          placeholder={
            isBashMode
              ? "Enter bash command..."
              : "Send a message..."
          }
          className={`flex-1 min-w-0 bg-muted/50 pl-2 md:pl-3 pr-3 py-2 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:bg-muted/70 resize-none min-h-[40px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed md:text-sm rounded-lg [field-sizing:content] ${
            isBashMode
              ? 'border-warning/50 bg-warning/5 focus:bg-warning/10'
              : isDragging ? 'border-info/50 border-dashed bg-info/5' : ''
          }`}
          rows={1}
        />
        {(hasPendingPermissionForSession || hasPromptContent) && (
          <button
            data-submit-prompt
            onClick={hasPendingPermissionForSession ? () => setShowDialog(true) : handleSubmit}
            disabled={hasPendingPermissionForSession ? false : (!isModelReady || !hasPromptContent || (isPromptSubmitPending && !isStreamingResponse))}
            className={`px-4 md:px-5 h-9 md:h-auto md:py-2 rounded-lg text-sm font-medium transition-colors dark:border flex-shrink-0 min-w-[52px] flex items-center justify-center ${
              hasPendingPermissionForSession
                ? 'bg-highlight hover:bg-highlight/90 border-highlight text-highlight-foreground ring-highlight/20'
                : 'bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground border-border/30'
            }`}
            title={hasPendingPermissionForSession ? 'View pending permission' : (isStreamingResponse ? 'Queue message' : 'Send')}
          >
            <span className="whitespace-nowrap">{hasPendingPermissionForSession ? 'View' : (isStreamingResponse ? 'Queue' : 'Send')}</span>
          </button>
        )}
      </div>

      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 py-2 mb-2">
          {imageAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/80 border border-border text-xs text-muted-foreground"
            >
              <span className="max-w-[120px] truncate">{attachment.filename}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                onClick={() => removeImageAttachment(attachment.id)}
                className="p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div data-testid="composer-controls-row" className="relative flex gap-1.5 md:gap-2 items-center justify-between">
        <ComposerActivityBar sessionID={sessionID} />
        <div className="flex flex-1 md:flex-initial gap-1.5 md:gap-2 items-center min-w-0">
          {showMobileKeys ? renderMobileKeys() : (
            <>
              <AgentQuickSelect
                directory={directory}
                currentAgent={currentMode}
                onAgentChange={handleAgentChange}
                isBashMode={isBashMode}
              />
              {directory && !isMobile ? (
                <>
                  <PermissionModeToggle sessionID={sessionID} directory={directory} />
                  {isLocalServer && <SessionSandboxMenu sessionID={sessionID} />}
                  <IconToggleButton
                    active={isGoalArmed}
                    label={goalButtonLabel}
                    disabled={isGoalModeDisabled}
                    onClick={toggleGoalArmed}
                  >
                    <Target className="w-5 h-5" />
                  </IconToggleButton>
                </>
              ) : null}
              <ComposerModelPill
                directory={directory}
                sessionID={sessionID}
                modelName={displayModelName}
                variant={modelPillVariant}
                modelSelectionSession={modelSelectionSession}
                open={isModelPickerOpen}
                onOpenChange={setIsModelPickerOpen}
                isCompacting={isCompacting}
                onCompact={handleCompact}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
{showStopButton && (
            <button
              onClick={handleStop}
              className="hidden md:block p-1.5 px-5 md:p-2 md:px-6 rounded-lg transition-all duration-200 active:scale-95 hover:scale-105 bg-destructive hover:bg-destructive/90 text-destructive-foreground border border-destructive/60 hover:border-destructive shadow-md shadow-destructive/30 hover:shadow-destructive/40 ring-1 ring-destructive/20 hover:ring-destructive/30"
              title="Stop"
            >
              <SquareFill className="w-4 h-4 md:w-5 md:h-5" />
            </button>
)}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES.join(',')}
            className="hidden"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            onClick={openFilePicker}
            className="hidden md:block p-2 rounded-lg bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-95 hover:scale-105 shadow-md border border-border"
            title="Upload image or PDF"
          >
            <Upload className="w-5 h-5" />
          </button>
          {showVoiceMic && renderVoiceMic()}
          {isMobile && directory && (
            <ComposerToolsMenu
              sessionID={sessionID}
              directory={directory}
              goalArmed={isGoalArmed}
              goalDisabled={isGoalModeDisabled}
              goalLabel={goalButtonLabel}
              onToggleGoal={toggleGoalArmed}
              onAttachFile={openFilePicker}
            />
          )}
        </div>
      </div>
        </>
      )}

      {!isVoiceActive && (
        <>
      <PromptSuggestions
        isOpen={showSuggestions}
        items={commandSuggestions}
        selectedIndex={selectedCommandIndex}
        takeover={isMobile}
        onSelect={handleCommandSelect}
        onSwipeRight={handleCommandSwipe}
        onClose={() => {
          setShowSuggestions(false)
          setSuggestionQuery('')
        }}
      />

      <PromptSuggestions
        isOpen={showMentionSuggestions}
        items={mentionSuggestions}
        selectedIndex={selectedMentionIndex}
        takeover={isMobile}
        onSelect={handleMentionSelect}
        onClose={() => {
          setShowMentionSuggestions(false)
          setMentionQuery('')
          setMentionRange(null)
        }}
      />
        </>
      )}
    </div>
  )
}))
