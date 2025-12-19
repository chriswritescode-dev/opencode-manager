import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createOpenCodeClient } from '@/api/opencode'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useModelSelection } from '@/hooks/useModelSelection'
import { showToast } from '@/lib/toast'
import type { components } from '@/api/opencode-types'
import { useSessionStatus } from '@/stores/sessionStatusStore'

type CommandType = components['schemas']['Command']

interface CommandHandlerProps {
  opcodeUrl: string
  sessionID: string
  directory?: string
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
  onToggleDetails?: () => boolean
  onExportSession?: () => void
}

export function useCommandHandler({
  opcodeUrl,
  sessionID,
  directory,
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog,
  onToggleDetails,
  onExportSession
}: CommandHandlerProps) {
  const navigate = useNavigate()
  const createSession = useCreateSession(opcodeUrl, directory)
  const { model } = useModelSelection(opcodeUrl, directory)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
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
          
        case 'details':
          if (onToggleDetails) {
            const expanded = onToggleDetails()
            showToast.success(expanded ? 'Tool details expanded' : 'Tool details collapsed')
          }
          break
          
        case 'export':
          if (onExportSession) {
            onExportSession()
          }
          break

        case 'compact':
        case 'summarize': {
          if (!model?.providerID || !model?.modelID) {
            showToast.error('No model selected. Please select a provider and model first.')
            break
          }

          showToast.info('Compacting session...', { duration: 2000 })

          setSessionStatus(sessionID, { type: 'compact' })

          await client.summarizeSession(
            sessionID,
            model.providerID,
            model.modelID
          )
          break
        }
          
        case 'share':
        case 'unshare':
        case 'undo':
        case 'redo':
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
      showToast.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setSessionStatus(sessionID, { type: 'idle' })
    } finally {
      setLoading(false)
    }
  }, [sessionID, opcodeUrl, directory, onShowSessionsDialog, onShowModelsDialog, onShowHelpDialog, onToggleDetails, onExportSession, createSession, navigate, model, setSessionStatus])

  return {
    executeCommand,
    loading
  }
}