import { useState, useRef, useEffect, useMemo, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react'
import { useSendPrompt, useAbortSession, useMessages, useSendShell, useAgents } from '@/hooks/useOpenCode'
import { useCommands } from '@/hooks/useCommands'
import { useCommandHandler } from '@/hooks/useCommandHandler'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { useSessionAgent } from '@/hooks/useSessionAgent'
import { useSTT } from '@/hooks/useSTT'

import { useUserBash } from '@/stores/userBashStore'
import { useMobile } from '@/hooks/useMobile'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { usePermissions } from '@/contexts/EventContext'
import { ChevronDown, Upload, X, Mic } from 'lucide-react'

import { CommandSuggestions } from '@/components/command/CommandSuggestions'
import { SquareFill } from '@/components/ui/square-fill'
import { MentionSuggestions, type MentionItem } from './MentionSuggestions'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { ModelQuickSelect } from '@/components/model/ModelQuickSelect'
import { AgentQuickSelect } from '@/components/agent/AgentQuickSelect'
import { detectMentionTrigger, parsePromptToParts, getFilename, filterAgentsByQuery } from '@/lib/promptParser'


import type { components } from '@/api/opencode-types'
import type { MessageWithParts, FileInfo, ImageAttachment } from '@/api/types'

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif"]


const revokeBlobUrls = (attachments: ImageAttachment[]) => {
  attachments.forEach((attachment) => {
    if (attachment.dataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.dataUrl)
    }
  })
}

const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]


type CommandType = components['schemas']['Command']

export interface PromptInputHandle {
  setPromptValue: (value: string) => void
  clearPrompt: () => void
  triggerFileUpload: () => void
}

interface PromptInputProps {
  opcodeUrl: string
  directory?: string
  sessionID: string
  disabled?: boolean
  showScrollButton?: boolean
  onScrollToBottom?: () => void
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
  onToggleDetails?: () => boolean
  onExportSession?: () => void
  onPromptChange?: (hasContent: boolean) => void
}

export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput({ 
  opcodeUrl,
  directory,
  sessionID, 
  disabled,
  showScrollButton,
  onScrollToBottom,
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog,
  onToggleDetails,
  onExportSession,
  onPromptChange
}, ref) {
  const [prompt, setPrompt] = useState('')
  const [isBashMode, setIsBashMode] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [attachedFiles, setAttachedFiles] = useState(new Map<string, FileInfo>())
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionRange, setMentionRange] = useState<{ start: number, end: number } | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [localMode, setLocalMode] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const {
    isRecording,
    startRecording,
    stopRecording,
    isSupported: sttSupported,
    isEnabled: sttEnabled,
    interimTranscript,
    clear: clearSTT,
  } = useSTT()
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  useImperativeHandle(ref, () => ({
    setPromptValue: (value: string) => {
      setPrompt(value)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        textareaRef.current.focus()
      }
    },
    clearPrompt: () => {
      setPrompt('')
      setAttachedFiles(new Map())
      revokeBlobUrls(imageAttachments)
      setImageAttachments([])
      setSelectedAgent(null)
      clearSTT()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.focus()
      }
    },
    triggerFileUpload: () => {
      fileInputRef.current?.click()
    }
  }), [imageAttachments, clearSTT])
  const sendPrompt = useSendPrompt(opcodeUrl, directory)
  const sendShell = useSendShell(opcodeUrl, directory)
  const abortSession = useAbortSession(opcodeUrl, directory, sessionID)
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)
  const { filterCommands } = useCommands(opcodeUrl)
  const { executeCommand } = useCommandHandler({
    opcodeUrl,
    sessionID,
    directory,
    onShowSessionsDialog,
    onShowModelsDialog,
    onShowHelpDialog,
    onToggleDetails,
    onExportSession
  })
  
  const { files: searchResults } = useFileSearch(
    opcodeUrl,
    mentionQuery,
    showMentionSuggestions,
    directory
  )
  
  const { data: agents = [] } = useAgents(opcodeUrl, directory)
  
  const mentionItems = useMemo((): MentionItem[] => {
    const filteredAgents = filterAgentsByQuery(
      agents.map(a => ({ name: a.name, description: a.description })),
      mentionQuery
    )
    
    const agentItems: MentionItem[] = filteredAgents.map(agent => ({
      type: 'agent',
      value: agent.name,
      label: agent.name,
      description: agent.description
    }))
    
    const fileItems: MentionItem[] = searchResults.map(file => ({
      type: 'file',
      value: file,
      label: getFilename(file),
      description: file
    }))
    
    return [...agentItems, ...fileItems]
  }, [agents, searchResults, mentionQuery])
  

  const { addUserBashCommand } = useUserBash()

  const handleSubmit = () => {
    if (disabled) return
    if (!prompt.trim() && imageAttachments.length === 0) return

    if (hasActiveStream) {
      const parts = parsePromptToParts(prompt, attachedFiles, imageAttachments)
      sendPrompt.mutate({
        sessionID,
        parts,
        model: currentModel,
        agent: selectedAgent || currentMode,
        variant: currentVariant
      })
      setPrompt('')
      setAttachedFiles(new Map())
      revokeBlobUrls(imageAttachments)
      setImageAttachments([])
      setSelectedAgent(null)
      clearSTT()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      return
    }

    if (isBashMode) {
      const command = prompt.startsWith('!') ? prompt.slice(1) : prompt
      addUserBashCommand(command)
      sendShell.mutate({
        sessionID,
        command,
        agent: currentMode
      })
      setPrompt('')
      setIsBashMode(false)
      clearSTT()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      return
    }

    

    const commandMatch = prompt.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
    if (commandMatch) {
      const [, commandName, commandArgs] = commandMatch
      const command = filterCommands(commandName)[0]
      
      if (command) {
        executeCommand(command, commandArgs?.trim() || '')
        setPrompt('')
        clearSTT()
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
        return
      }
    }

    const parts = parsePromptToParts(prompt, attachedFiles, imageAttachments)

    sendPrompt.mutate({
      sessionID,
      parts,
      model: currentModel,
      agent: selectedAgent || currentMode,
      variant: currentVariant
    })

    setPrompt('')
    setAttachedFiles(new Map())
    revokeBlobUrls(imageAttachments)
    setImageAttachments([])
    setSelectedAgent(null)
    clearSTT()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleStop = () => {
    abortSession.mutate(sessionID)
  }

  const handleCommandSelect = async (command: CommandType) => {
    if (!textareaRef.current) return
    
    setShowSuggestions(false)
    setSuggestionQuery('')
    
    if (command.template) {
      const cleanedTemplate = command.template
        .replace(/\$ARGUMENTS/g, '')
        .replace(/\$\d+/g, '')
        .trim()
      
      setPrompt(cleanedTemplate)
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(cleanedTemplate.length, cleanedTemplate.length)
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
      }, 0)
    } else {
      const cursorPosition = textareaRef.current.selectionStart
      const commandMatch = prompt.slice(0, cursorPosition).match(/(^|\s)\/([a-zA-Z0-9_-]*)$/)
      
      if (commandMatch) {
        const beforeCommand = prompt.slice(0, commandMatch.index)
        const afterCommand = prompt.slice(cursorPosition)
        const newPrompt = beforeCommand + '/' + command.name + ' ' + afterCommand
        
        setPrompt(newPrompt)
        
        setTimeout(() => {
          if (textareaRef.current) {
            const newCursorPos = beforeCommand.length + command.name.length + 2
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
          }
        }, 0)
      }
    }
  }
  
  const handleMentionSelect = (item: MentionItem) => {
    if (!mentionRange || !textareaRef.current) return
    
    const beforeMention = prompt.slice(0, mentionRange.start)
    const afterMention = prompt.slice(mentionRange.end)
    
    if (item.type === 'agent') {
      const newPrompt = beforeMention + '@' + item.value + ' ' + afterMention
      setPrompt(newPrompt)
      setSelectedAgent(item.value)
      
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = beforeMention.length + item.value.length + 2
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    } else {
      const filename = getFilename(item.value)
      const newPrompt = beforeMention + '@' + filename + ' ' + afterMention
      setPrompt(newPrompt)
      
      const absolutePath = item.value.startsWith('/') 
        ? item.value 
        : directory 
          ? `${directory}/${item.value}` 
          : item.value
      
      setAttachedFiles(prev => {
        const next = new Map(prev)
        next.set(filename.toLowerCase(), {
          path: absolutePath,
          name: filename
        })
        return next
      })
      
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = beforeMention.length + filename.length + 2
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    }
    
    setShowMentionSuggestions(false)
    setMentionQuery('')
    setMentionRange(null)
  }

  const handleAgentChange = (agent: string) => {
    setLocalMode(agent)
  }

  const handleVoiceToggle = async () => {
    if (isRecording) {
      stopRecording()
    } else {
      await startRecording()
      if (textareaRef.current) {
        textareaRef.current.blur()
      }
    }
  }

  useEffect(() => {
    if (!isRecording && interimTranscript && !prompt) {
      const trimmedTranscript = interimTranscript.trim()
      if (trimmedTranscript) {
        setPrompt(trimmedTranscript)
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
            textareaRef.current.focus()
          }
        }, 0)
      }
    }
  }, [isRecording, interimTranscript, prompt])

  const addImageAttachment = (file: File) => {
    const generateId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
      }
      return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    }

    try {
      const reader = new FileReader()
      
      reader.onloadend = () => {
        try {
          if (reader.readyState !== 2) return
          
          const dataUrl = reader.result as string
          
          if (!dataUrl) {
            const blobUrl = URL.createObjectURL(file)
            const attachment: ImageAttachment = {
              id: generateId(),
              filename: file.name,
              mime: file.type || 'image/png',
              dataUrl: blobUrl,
            }
            setImageAttachments((prev) => [...prev, attachment])
            return
          }
          
          const attachment: ImageAttachment = {
            id: generateId(),
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
                addImageAttachment(file)
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
    
    const imageItems = items.filter((item) => {
      if (item.kind !== 'file') return false
      
      const hasKnownType = ACCEPTED_FILE_TYPES.includes(item.type)
      const isLikelyImage = item.type.startsWith('image/')
      const hasNoType = !item.type || item.type === ''
      
      return hasKnownType || isLikelyImage || hasNoType
    })

    if (imageItems.length > 0) {
      event.preventDefault()
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) {
          const isValidImageFile = 
            ACCEPTED_FILE_TYPES.includes(file.type) ||
            file.type.startsWith('image/') ||
            file.size > 0
          
          if (isValidImageFile) {
            addImageAttachment(file)
          }
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
        if (ACCEPTED_FILE_TYPES.includes(file.type)) {
          addImageAttachment(file)
        }
      }
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file && ACCEPTED_FILE_TYPES.includes(file.type)) {
      addImageAttachment(file)
    }
    event.currentTarget.value = ''
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isBashMode && e.key === 'Escape') {
      e.preventDefault()
      setIsBashMode(false)
      setPrompt('')
      return
    }

    if (showMentionSuggestions && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex(prev => 
          prev < mentionItems.length - 1 ? prev + 1 : prev
        )
        return
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex(prev => prev > 0 ? prev - 1 : 0)
        return
      }
      
      if (e.key === 'Enter') {
        e.preventDefault()
        if (mentionItems[selectedMentionIndex]) {
          handleMentionSelect(mentionItems[selectedMentionIndex])
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
      const filteredCommands = filterCommands(suggestionQuery)
      
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(prev => (prev + 1) % filteredCommands.length)
        return
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      
      if (e.key === 'Enter') {
        e.preventDefault()
        const selectedCommand = filteredCommands[selectedCommandIndex]
        if (selectedCommand) {
          handleCommandSelect(selectedCommand)
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
    
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (isMobile && !e.shiftKey))) {
      e.preventDefault()
      if (isMobile) {
        textareaRef.current?.blur()
      }
      handleSubmit()
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setSuggestionQuery('')
      setShowMentionSuggestions(false)
      setMentionQuery('')
      setMentionRange(null)
      setPrompt('')
      revokeBlobUrls(imageAttachments)
      setImageAttachments([])
      clearSTT()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
      e.preventDefault()
      if (hasVariants) {
        cycleVariant()
      }
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
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }

    if (isBashMode) {
      return
    }

    const cursorPosition = e.target.selectionStart
    
    const mentionTrigger = detectMentionTrigger(value, cursorPosition)
    
    if (mentionTrigger) {
      setMentionQuery(mentionTrigger.query)
      setMentionRange({ start: mentionTrigger.start, end: mentionTrigger.end })
      setShowMentionSuggestions(true)
      setSelectedMentionIndex(0)
    } else {
      const commandMatch = value.slice(0, cursorPosition).match(/(^|\s)\/([a-zA-Z0-9_-]*)$/)
      
      if (commandMatch) {
        const query = commandMatch[2]
        setSuggestionQuery(query)
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
  }

  const isMessageIncomplete = (msg: MessageWithParts): boolean => {
    if (msg.info.role !== 'assistant') return false
    return !('completed' in msg.info.time && msg.info.time.completed)
  }

  const lastAssistantMessage = messages?.filter(msg => msg.info.role === 'assistant').at(-1)
  const hasIncompleteMessages = lastAssistantMessage ? isMessageIncomplete(lastAssistantMessage) : false

  const sessionAgent = useSessionAgent(opcodeUrl, sessionID, directory)
  const currentMode = localMode ?? sessionAgent.agent

const { model, modelString } = useModelSelection(opcodeUrl, directory)
  const currentModel = modelString || ''
  const displayModelName = model?.modelID || currentModel
  const isMobile = useMobile()
  const { setShowDialog, hasForSession: hasPermissionsForSession } = usePermissions()
  const hasPendingPermissionForSession = hasPermissionsForSession(sessionID)
  const { hasVariants, currentVariant, cycleVariant } = useVariants(opcodeUrl, directory)
  const sessionStatus = useSessionStatusForSession(sessionID)
  const isSessionActive = sessionStatus.type === 'busy' || sessionStatus.type === 'retry'
  const hasActiveStream = hasIncompleteMessages && isSessionActive
  const showStopButton = isSessionActive && hasIncompleteMessages
  const hideSecondaryButtons = isMobile && hasActiveStream

  

  

  

  useEffect(() => {
    onPromptChange?.(prompt.trim().length > 0)
  }, [prompt, onPromptChange])

  useEffect(() => {
    setLocalMode(null)
  }, [sessionID])

  

  

return (
    <div className={`relative backdrop-blur-md bg-background opacity-95 border border-border dark:border-white/30 rounded-xl p-2 md:p-3 mb-4 md:mb-1 w-full transition-all ${hasPendingPermissionForSession ? 'border-orange-500/50 ring-1 ring-orange-500/30' : ''}`}>
      {showStopButton && !(isFocused && prompt.trim().length > 0) && (
        <button
          onClick={handleStop}
          disabled={disabled}
          className="border border-white fixed bottom-19 right-0 md:hidden z-50 p-3 rounded-xl transition-all duration-200 active:scale-95 hover:scale-105 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border border-red-500/60 shadow-lg shadow-red-500/30"
          title="Stop"
        >
          <SquareFill className="w-5 h-5" />
        </button>
      )}

      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={handleInput}
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
        disabled={disabled}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`w-full bg-muted/50 pl-2 md:pl-3 pr-3 py-2 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:bg-muted/70 resize-none min-h-[40px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed md:text-sm rounded-lg ${
          isBashMode
            ? 'border-purple-500/50 bg-purple-500/5 focus:bg-purple-500/10'
            : isDragging ? 'border-blue-500/50 border-dashed bg-blue-500/5' : ''
        }`}
        rows={1}
      />

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
                onClick={() => removeImageAttachment(attachment.id)}
                className="p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 md:gap-2 items-center justify-between">
        <div className="flex gap-1.5 md:gap-2 items-center">
          <AgentQuickSelect
            opcodeUrl={opcodeUrl}
            directory={directory}
            currentAgent={currentMode}
            onAgentChange={handleAgentChange}
            isBashMode={isBashMode}
            disabled={disabled}
          />
          {hasActiveStream ? (
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm font-medium text-muted-foreground max-w-[120px] md:max-w-[180px]">
                <SessionStatusIndicator sessionID={sessionID} />
              </div>
            ) : (
               !hideSecondaryButtons && (
                 <ModelQuickSelect
                   opcodeUrl={opcodeUrl}
                   directory={directory}
                   onOpenFullDialog={() => onShowModelsDialog?.()}
                 >
                   <button
                     className="px-2.5 py-0.5 md:px-3 min-h-[36px] rounded-lg text-xs md:text-sm font-medium border bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10 hover:border-foreground/30 transition-colors cursor-pointer max-w-[150px] md:max-w-[220px] dark:border-white/30 flex flex-col items-start justify-center"
                   >
                     <span className="truncate w-full text-left">{displayModelName || 'Select model'}</span>
{hasVariants && currentVariant && (
                        <span className="text-[10px] text-orange-500 truncate w-full text-center capitalize">{currentVariant}</span>
                      )}
                   </button>
                 </ModelQuickSelect>
                )
             )}
          
        </div>
<div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <button
               onClick={onScrollToBottom}
               className={`p-1.5 md:p-2 rounded-lg bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-95 hover:scale-105 shadow-md shadow-blue-500/20 hover:shadow-blue-500/30 border border-blue-500/30 hover:border-blue-500 dark:border-blue-400/30 dark:hover:border-blue-400 ring-1 ring-blue-500/20 hover:ring-blue-500/30 ${showScrollButton ? 'visible' : 'invisible'}`}
               title="Scroll to bottom"
             >
               <ChevronDown className="w-5 h-5" />
             </button>
{showStopButton && (
            <button
              onClick={handleStop}
              disabled={disabled}
              className="hidden md:block p-1.5 px-5 md:p-2 md:px-6 rounded-lg transition-all duration-200 active:scale-95 hover:scale-105 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border border-red-500/60 hover:border-red-400 shadow-md shadow-red-500/30 hover:shadow-red-500/40 ring-1 ring-red-500/20 hover:ring-red-500/30"
              title="Stop"
            >
              <SquareFill className="w-4 h-4 md:w-5 md:h-5" />
            </button>
)}
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hidden md:block p-2 rounded-lg bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-95 hover:scale-105 shadow-md border border-border"
            title="Upload image or PDF"
          >
            <Upload className="w-5 h-5" />
          </button>
          {isMobile && !prompt.trim() && imageAttachments.length === 0 && sttEnabled && sttSupported && !hasPendingPermissionForSession ? (
            <button
              onClick={handleVoiceToggle}
              disabled={disabled}
              className={`px-4 py-2 rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center min-w-[52px] ${
                isRecording
                  ? 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border-2 border-red-500/60 shadow-lg shadow-red-500/30 animate-pulse'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground border border-white/30'
              }`}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              {isRecording ? <SquareFill className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          ) : (
            <button
              data-submit-prompt
              onClick={hasPendingPermissionForSession ? () => setShowDialog(true) : handleSubmit}
              disabled={hasPendingPermissionForSession ? false : ((!prompt.trim() && imageAttachments.length === 0) || disabled)}
              className={`px-4 md:px-5 py-1.5 md:py-2 rounded-lg text-sm font-medium transition-colors dark:border flex-shrink-0 min-w-[52px] ${
                hasPendingPermissionForSession
                  ? 'bg-orange-500 hover:bg-orange-600 border-orange-400 text-primary-foreground ring-orange-500/20'
                  : 'bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground border-white/30'
              }`}
              title={hasPendingPermissionForSession ? 'View pending permission' : (hasActiveStream ? 'Queue message' : 'Send')}
            >
              <span className="whitespace-nowrap">{hasPendingPermissionForSession ? 'View' : (hasActiveStream ? 'Queue' : 'Send')}</span>
            </button>
          )}
        </div>
      </div>
      
      <CommandSuggestions
        isOpen={showSuggestions}
        query={suggestionQuery}
        commands={filterCommands(suggestionQuery)}
        onSelect={handleCommandSelect}
        onClose={() => {
          setShowSuggestions(false)
          setSuggestionQuery('')
        }}
        selectedIndex={selectedCommandIndex}
      />
      
      <MentionSuggestions
        isOpen={showMentionSuggestions}
        items={mentionItems}
        onSelect={handleMentionSelect}
        onClose={() => {
          setShowMentionSuggestions(false)
          setMentionQuery('')
          setMentionRange(null)
        }}
        selectedIndex={selectedMentionIndex}
      />
    </div>
  )
})
