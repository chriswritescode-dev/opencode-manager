import { useState, useRef, useEffect, useMemo, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react'
import { useSendPrompt, useAbortSession, useMessages, useSendShell, useAgents } from '@/hooks/useOpenCode'
import { useSettings } from '@/hooks/useSettings'
import { useCommands } from '@/hooks/useCommands'
import { useCommandHandler } from '@/hooks/useCommandHandler'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useModelSelection } from '@/hooks/useModelSelection'

import { useUserBash } from '@/stores/userBashStore'
import { useMobile } from '@/hooks/useMobile'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { ChevronDown, Square } from 'lucide-react'

import { CommandSuggestions } from '@/components/command/CommandSuggestions'
import { MentionSuggestions, type MentionItem } from './MentionSuggestions'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { detectMentionTrigger, parsePromptToParts, getFilename, filterAgentsByQuery } from '@/lib/promptParser'


import type { components } from '@/api/opencode-types'
import type { MessageWithParts, FileInfo } from '@/api/types'


type CommandType = components['schemas']['Command']

export interface PromptInputHandle {
  setPromptValue: (value: string) => void
  clearPrompt: () => void
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
      setSelectedAgent(null)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }), [])
  
  const [isBashMode, setIsBashMode] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [attachedFiles, setAttachedFiles] = useState(new Map<string, FileInfo>())
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionRange, setMentionRange] = useState<{ start: number, end: number } | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendPrompt = useSendPrompt(opcodeUrl, directory)
  const sendShell = useSendShell(opcodeUrl, directory)
  const abortSession = useAbortSession(opcodeUrl, directory, sessionID)
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)
  const { preferences, updateSettings } = useSettings()
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
    if (!prompt.trim() || disabled) return
    
    if (hasActiveStream) {
      const parts = parsePromptToParts(prompt, attachedFiles)
      sendPrompt.mutate({
        sessionID,
        parts,
        model: currentModel,
        agent: selectedAgent || currentMode
      })
      setPrompt('')
      setAttachedFiles(new Map())
      setSelectedAgent(null)
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
      agent: selectedAgent || currentMode
    })

    setPrompt('')
    setAttachedFiles(new Map())
    setSelectedAgent(null)
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

  const isMessageStreaming = (msg: MessageWithParts): boolean => {
    if (msg.info.role !== 'assistant') return false
    return !('completed' in msg.info.time && msg.info.time.completed)
  }

  const hasActiveStream = messages?.some(msg => isMessageStreaming(msg)) || false

  const currentMode = preferences?.mode || 'build'
  const modeColor = currentMode === 'plan' ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500'
  const modeBg = currentMode === 'plan' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-green-500/10 border-green-500/30'

  const { modelString } = useModelSelection(opcodeUrl, directory)
  const currentModel = modelString || ''
  const isMobile = useMobile()
  const sessionStatus = useSessionStatusForSession(sessionID)
  const showStopButton = hasActiveStream && (sessionStatus.type === 'busy' || sessionStatus.type === 'retry')
  const hideSecondaryButtons = isMobile && hasActiveStream

  

  

  useEffect(() => {
    if (textareaRef.current && !disabled) {
      textareaRef.current.focus()
    }
  }, [disabled])

  useEffect(() => {
    onPromptChange?.(prompt.trim().length > 0)
  }, [prompt, onPromptChange])

  

  return (
    <div className="relative backdrop-blur-md bg-background opacity-95 border border-border dark:border-white/30 rounded-xl p-2 md:p-3 md:mx-4 mb-4 md:mb-1 w-[94%] md:max-w-4xl">
      
      
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={
          isBashMode 
            ? "Enter bash command..." 
            : "Send a message..."
        }
        disabled={disabled}
        className={`w-full bg-muted/50 px-2 md:px-3 py-2 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:bg-muted/70 resize-none min-h-[40px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed md:text-sm rounded-lg ${
          isBashMode 
            ? 'border-purple-500/50 bg-purple-500/5 focus:bg-purple-500/10' 
            : ''
        }`}
        rows={1}
      />
      
      <div className="flex gap-1.5 md:gap-2 items-center justify-between">
        <div className="flex gap-1.5 md:gap-2 items-center">
          <button
            onClick={handleModeToggle}
            className={`px-2 py-1 rounded-md text-xs font-medium border w-14 ${
              isBashMode 
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400' 
                : `${modeBg} ${modeColor}`
            } hover:opacity-80 transition-opacity cursor-pointer`}
          >
            {isBashMode ? 'BASH' : currentMode.toUpperCase()} 
          </button>
          {hasActiveStream ? (
              <div className="px-2 py-1 rounded-md text-xs font-medium border bg-muted border-border text-muted-foreground max-w-[120px] md:max-w-[180px] truncate">
                <SessionStatusIndicator sessionID={sessionID} />
              </div>
            ) : (
              !hideSecondaryButtons && (
                <button
                  onClick={onShowModelsDialog}
                  className="px-2 py-1 rounded-md text-xs font-medium border bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10 transition-colors cursor-pointer max-w-[120px] md:max-w-[180px] truncate"
                >
                  {currentModel.length > 12 ? currentModel.substring(0, 10) + '...' : currentModel || 'Select model'}
                </button>
              )
            )}
          
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
          <button
              onClick={onScrollToBottom}
              className={`p-1.5 md:p-2 rounded-lg bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors border border-transparent ${showScrollButton ? 'border-foreground/30 visible' : 'invisible'}`}
              title="Scroll to bottom"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
{showStopButton && (
            <button
              onClick={handleStop}
              disabled={disabled}
              className="p-1.5 px-4 md:p-2 rounded-lg transition-colors bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <button
            data-submit-prompt
            onClick={handleSubmit}
            disabled={!prompt.trim() || disabled}
            className="px-5 md:px-6 py-1.5 md:py-2 rounded-lg text-sm font-medium transition-colors bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground"
            title={hasActiveStream ? 'Queue message' : 'Send'}
          >
            {hasActiveStream ? 'Queue' : 'Send'}
          </button>
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
