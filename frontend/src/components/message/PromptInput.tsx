import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useSendPrompt, useAbortSession, useMessages, useSendShell, useConfig } from '@/hooks/useOpenCode'
import { useSettings } from '@/hooks/useSettings'
import { useCommands } from '@/hooks/useCommands'
import { useCommandHandler } from '@/hooks/useCommandHandler'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useMobile } from '@/hooks/useMobile'
import { CommandSuggestions } from '@/components/command/CommandSuggestions'
import { FileSuggestions } from './FileSuggestions'
import { detectMentionTrigger, parsePromptToParts, getFilename } from '@/lib/promptParser'
import { getModel, formatModelName } from '@/api/providers'
import type { components } from '@/api/opencode-types'
import type { MessageWithParts, FileInfo } from '@/api/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type CommandType = components['schemas']['Command']

interface PromptInputProps {
  opcodeUrl: string
  directory?: string
  sessionID: string
  disabled?: boolean
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
}

export function PromptInput({ 
  opcodeUrl,
  directory,
  sessionID, 
  disabled, 
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog
}: PromptInputProps) {
  const [prompt, setPrompt] = useState('')
  const [modelName, setModelName] = useState<string>('')
  const [isBashMode, setIsBashMode] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [suggestionPosition, setSuggestionPosition] = useState({ bottom: 0, left: 0, width: 0 })
  const [attachedFiles, setAttachedFiles] = useState(new Map<string, FileInfo>())
  const [showFileSuggestions, setShowFileSuggestions] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileSuggestionPosition, setFileSuggestionPosition] = useState({ bottom: 0, left: 0, width: 0 })
  const [mentionRange, setMentionRange] = useState<{ start: number, end: number } | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const isMobile = useMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendPrompt = useSendPrompt(opcodeUrl, directory)
  const sendShell = useSendShell(opcodeUrl, directory)
  const abortSession = useAbortSession(opcodeUrl, directory)
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)
  const { data: config } = useConfig(opcodeUrl)
  const { preferences, updateSettings } = useSettings()
  const { filterCommands } = useCommands(opcodeUrl)
  const { executeCommand } = useCommandHandler({
    opcodeUrl,
    sessionID,
    directory,
    onShowSessionsDialog,
    onShowModelsDialog,
    onShowHelpDialog
  })
  
  const { files: searchResults } = useFileSearch(
    opcodeUrl,
    fileQuery,
    showFileSuggestions,
    directory
  )

  const handleSubmit = () => {
    if (!prompt.trim() || disabled) return

    if (isBashMode) {
      const command = prompt.startsWith('!') ? prompt.slice(1) : prompt
      sendShell.mutate({
        sessionID,
        command,
        agent: currentMode
      })
      setPrompt('')
      setIsBashMode(false)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      return
    }

    

    const commandMatch = prompt.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
    if (commandMatch) {
      const [, commandName] = commandMatch
      const command = filterCommands(commandName)[0]
      
      if (command) {
        
        executeCommand(command)
        setPrompt('')
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
        return
      }
    }

    const parts = parsePromptToParts(prompt, attachedFiles)
    
    sendPrompt.mutate({
      sessionID,
      parts,
      model: currentModel,
      agent: currentMode
    })

    setPrompt('')
    setAttachedFiles(new Map())
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
  
  const handleFileSelect = (filePath: string) => {
    if (!mentionRange || !textareaRef.current) return
    
    const filename = getFilename(filePath)
    const beforeMention = prompt.slice(0, mentionRange.start)
    const afterMention = prompt.slice(mentionRange.end)
    
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
    
    setShowFileSuggestions(false)
    setFileQuery('')
    setMentionRange(null)
    
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = beforeMention.length + filename.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleModeToggle = () => {
    const newMode = currentMode === 'plan' ? 'build' : 'plan'
    updateSettings({ mode: newMode })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isBashMode && e.key === 'Escape') {
      e.preventDefault()
      setIsBashMode(false)
      setPrompt('')
      return
    }

    if (showFileSuggestions && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedFileIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : prev
        )
        return
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedFileIndex(prev => prev > 0 ? prev - 1 : 0)
        return
      }
      
      if (e.key === 'Enter') {
        e.preventDefault()
        if (searchResults[selectedFileIndex]) {
          handleFileSelect(searchResults[selectedFileIndex])
        }
        return
      }
      
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowFileSuggestions(false)
        setFileQuery('')
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
    
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setSuggestionQuery('')
      setShowFileSuggestions(false)
      setFileQuery('')
      setMentionRange(null)
      setPrompt('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
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
      setFileQuery(mentionTrigger.query)
      setMentionRange({ start: mentionTrigger.start, end: mentionTrigger.end })
      setShowFileSuggestions(true)
      setSelectedFileIndex(0)
      
      if (textareaRef.current) {
        const rect = textareaRef.current.getBoundingClientRect()
        setFileSuggestionPosition({
          bottom: window.innerHeight - rect.top + window.scrollY + 4,
          left: rect.left + window.scrollX,
          width: rect.width
        })
      }
    } else {
      const commandMatch = value.slice(0, cursorPosition).match(/(^|\s)\/([a-zA-Z0-9_-]*)$/)
      
      if (commandMatch) {
        const query = commandMatch[2]
        setSuggestionQuery(query)
        setShowSuggestions(true)
        setSelectedCommandIndex(0)
        
        if (textareaRef.current) {
          const rect = textareaRef.current.getBoundingClientRect()
          setSuggestionPosition({
            bottom: window.innerHeight - rect.top + window.scrollY + 4,
            left: rect.left + window.scrollX,
            width: rect.width
          })
        }
      } else {
        setShowSuggestions(false)
        setSuggestionQuery('')
      }
      
      if (showFileSuggestions) {
        setShowFileSuggestions(false)
        setFileQuery('')
        setMentionRange(null)
      }
    }
  }

  const isMessageStreaming = (msg: MessageWithParts): boolean => {
    if (msg.info.role !== 'assistant') return false
    return !('completed' in msg.info.time && msg.info.time.completed)
  }

  const hasActiveStream = messages?.some(msg => isMessageStreaming(msg)) || false

  const currentMode = preferences?.mode || 'build'
  const modeColor = currentMode === 'plan' ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500'
  const modeBg = currentMode === 'plan' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-green-500/10 border-green-500/30'

  const lastAssistantMessage = messages?.filter(msg => msg.info.role === 'assistant').pop()
  const sessionModel = lastAssistantMessage?.info.role === 'assistant' 
    ? `${lastAssistantMessage.info.providerID}/${lastAssistantMessage.info.modelID}`
    : null
  const currentModel = sessionModel || config?.model || ''

  useEffect(() => {
    const loadModelName = async () => {
      if (currentModel) {
        try {
          const [providerId, modelId] = currentModel.split('/')
          if (providerId && modelId) {
            const model = await getModel(providerId, modelId)
            if (model) {
              setModelName(formatModelName(model))
            } else {
              setModelName(currentModel)
            }
          } else {
            setModelName(currentModel)
          }
        } catch {
          setModelName(currentModel)
        }
      } else {
        setModelName('No model selected')
      }
    }

    loadModelName()
  }, [currentModel])

  useEffect(() => {
    if (textareaRef.current && !disabled && !hasActiveStream) {
      textareaRef.current.focus()
    }
  }, [disabled, hasActiveStream])

  

  return (
    <div className="border-t border-border bg-background p-2 sm:p-3">
      {isMobile ? (
        <>
          <div className="mb-2">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={
                isBashMode 
                  ? "Enter bash command... (Esc to exit)" 
                  : "Message..."
              }
              disabled={disabled || hasActiveStream}
              className="w-full bg-background border rounded-lg px-3 py-2 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 resize-none min-h-[36px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
              rows={1}
            />
          </div>
          <div className="flex gap-2 items-center justify-between  mx-2">
            <div className="flex gap-2 items-center">
              <button
                onClick={handleModeToggle}
                className={`px-2 py-1 rounded-md text-xs font-medium border ${modeBg} ${modeColor} hover:opacity-80 transition-opacity cursor-pointer`}
              >
                {currentMode.toUpperCase()} MODE
              </button>
              {isBashMode && (
                <div className="px-2 py-1 rounded-md text-xs font-medium border bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400">
                  BASH MODE
                </div>
              )}
              {modelName && (
                <button
                  onClick={onShowModelsDialog}
                  className="px-2 py-1 rounded-md text-xs font-medium border bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10 transition-colors cursor-pointer"
                >
                  {modelName}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-6 h-6 rounded-full border-2 border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors flex items-center justify-center text-sm font-medium"
                    title="Help"
                  >
                    ?
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground font-medium">
                    Keyboard Shortcuts
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    <span className="font-mono">Cmd/Ctrl+Enter</span> - Send message
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    <span className="font-mono">@</span> - Mention files
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    <span className="font-mono">!</span> - Bash command mode
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              data-submit-prompt
              onClick={hasActiveStream ? handleStop : handleSubmit}
              disabled={(!prompt.trim() && !hasActiveStream) || disabled}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                hasActiveStream
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground'
              }`}
              title={hasActiveStream ? 'Stop' : 'Send'}
            >
              {hasActiveStream ? 'Stop' : 'Send'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2 items-end mb-2 justify-between">
            <div className="flex gap-2 items-end">
              <button
                onClick={handleModeToggle}
                className={`w-16 px-2 py-1 rounded-md text-xs font-medium border ${modeBg} ${modeColor} hover:opacity-80 transition-opacity cursor-pointer`}
              >
                {currentMode.toUpperCase()} 
              </button>
              {isBashMode && (
                <div className="px-2 py-1 rounded-md text-xs font-medium border bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400">
                  BASH MODE
                </div>
              )}
              {modelName && (
                <button
                  onClick={onShowModelsDialog}
                  className="px-2 py-1 rounded-md text-xs font-medium border bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10 transition-colors cursor-pointer"
                >
                  {modelName}
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-6 h-6 rounded-full border-2 border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors flex items-center justify-center text-sm font-medium"
                  title="Help"
                >
                  ?
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground font-medium">
                  Keyboard Shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  <span className="font-mono">Cmd/Ctrl+Enter</span> - Send message
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  <span className="font-mono">@</span> - Mention files
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  <span className="font-mono">!</span> - Bash command mode
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={
                isBashMode 
                  ? "Enter bash command... (Esc to exit)" 
                  : "Send a message... (Cmd/Ctrl+Enter)"
              }
              disabled={disabled || hasActiveStream}
              className={`flex-1 bg-background border rounded-lg px-3 py-2 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 resize-none min-h-[36px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed md:text-sm ${
                isBashMode 
                  ? 'border-purple-500/50 focus:ring-purple-500/50 bg-purple-500/5' 
                  : 'border-border focus:ring-primary/50'
              }`}
              rows={1}
            />
            <button
              data-submit-prompt
              onClick={hasActiveStream ? handleStop : handleSubmit}
              disabled={(!prompt.trim() && !hasActiveStream) || disabled}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                hasActiveStream
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground'
              }`}
              title={hasActiveStream ? 'Stop' : 'Send'}
            >
              {hasActiveStream ? '■' : '↑'}
            </button>
          </div>
        </>
      )}
      
      <CommandSuggestions
        isOpen={showSuggestions}
        query={suggestionQuery}
        commands={filterCommands(suggestionQuery)}
        onSelect={handleCommandSelect}
        onClose={() => {
          setShowSuggestions(false)
          setSuggestionQuery('')
        }}
        position={suggestionPosition}
        selectedIndex={selectedCommandIndex}
      />
      
      <FileSuggestions
        isOpen={showFileSuggestions}
        query={fileQuery}
        files={searchResults}
        onSelect={handleFileSelect}
        onClose={() => {
          setShowFileSuggestions(false)
          setFileQuery('')
          setMentionRange(null)
        }}
        position={fileSuggestionPosition}
        selectedIndex={selectedFileIndex}
      />
    </div>
  )
}
