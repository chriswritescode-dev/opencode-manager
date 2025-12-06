import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createOpenCodeClient } from '@/api/opencode'
import { useCreateSession } from '@/hooks/useOpenCode'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

interface CommandHandlerProps {
  opcodeUrl: string
  sessionID: string
  directory?: string
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
}

export function useCommandHandler({
  opcodeUrl,
  sessionID,
  directory,
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog
}: CommandHandlerProps) {
  const navigate = useNavigate()
  const createSession = useCreateSession(opcodeUrl, directory)
  const [loading, setLoading] = useState(false)

  const executeCommand = useCallback(async (command: CommandType, args: string = '') => {
    if (!opcodeUrl) return

    setLoading(true)
    
    try {
      const client = createOpenCodeClient(opcodeUrl, directory)
      
      switch (command.name) {
        case 'sessions':
        case 'resume':
        case 'continue':
          onShowSessionsDialog?.()
          break
          
        case 'models':
          onShowModelsDialog?.()
          break
          
        case 'themes':
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args
          })
          break
          
        case 'help':
          onShowHelpDialog?.()
          break
          
        case 'new':
        case 'clear':
          try {
            const newSession = await createSession.mutateAsync({
              agent: undefined
            })
            if (newSession?.id) {
              const currentPath = window.location.pathname
              const repoMatch = currentPath.match(/\/repos\/(\d+)\/sessions\//)
              if (repoMatch) {
                const repoId = repoMatch[1]
                const newPath = `/repos/${repoId}/sessions/${newSession.id}`
                navigate(newPath)
              } else {
                navigate(`/session/${newSession.id}`)
              }
            }
          } catch (error) {
            console.error('Failed to create new session:', error)
          }
          break
          
        case 'share':
        case 'unshare':
        case 'export':
        case 'compact':
        case 'summarize':
        case 'undo':
        case 'redo':
        case 'details':
        case 'editor':
        case 'init':
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args
          })
          break
          
        default:
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args
          })
      }
    } catch (error) {
      console.error('Failed to execute command:', error)
    } finally {
      setLoading(false)
    }
  }, [sessionID, opcodeUrl, onShowSessionsDialog, onShowModelsDialog, onShowHelpDialog, createSession, navigate])

  return {
    executeCommand,
    loading
  }
}