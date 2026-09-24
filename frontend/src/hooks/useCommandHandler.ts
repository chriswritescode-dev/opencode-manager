import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { compactSession, runCommand } from '@/api/opencode'
import type { PromptAgentInput, PromptFileInput, PromptSkillInput } from '@/api/opencode'
import { useCreateSession, useSyncSessionSelection } from '@/hooks/useOpenCode'
import { showToast } from '@/lib/toast'
import type { CommandInfo, ModelRef } from '@opencode-manager/shared/opencode'
import { useSessionStatus } from '@/stores/sessionStatusStore'

export interface CommandSubmission {
  text: string
  files?: PromptFileInput[]
  agents?: PromptAgentInput[]
  skills?: PromptSkillInput[]
}

interface CommandHandlerProps {
  sessionID: string
  directory?: string
  model?: ModelRef
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
  onToggleDetails?: () => boolean
  onExportSession?: () => void
  onUndo?: () => void | Promise<void>
  onRedo?: () => void | Promise<void>
  currentAgent?: string
}

export function useCommandHandler({
  sessionID,
  directory,
  model,
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog,
  onToggleDetails,
  onExportSession,
  onUndo,
  onRedo,
  currentAgent
}: CommandHandlerProps) {
  const navigate = useNavigate()
  const createSession = useCreateSession(directory)
  const syncSelection = useSyncSessionSelection(directory)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
  const [loading, setLoading] = useState(false)

  const executeCommand = useCallback(async (command: CommandInfo, submission: CommandSubmission = { text: '' }): Promise<boolean> => {
    setLoading(true)

    try {
      switch (command.name) {
        case 'sessions':
        case 'resume':
        case 'continue':
          onShowSessionsDialog?.()
          return true

        case 'models':
          onShowModelsDialog?.()
          return true

        case 'help':
          onShowHelpDialog?.()
          return true

        case 'new':
        case 'clear': {
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
            showToast.error(`Failed to create new session: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
          return true
        }

        case 'details':
          if (onToggleDetails) {
            const expanded = onToggleDetails()
            showToast.success(expanded ? 'Tool details expanded' : 'Tool details collapsed')
          }
          return true

        case 'export':
          onExportSession?.()
          return true

        case 'compact': {
          showToast.loading('Compacting session...', { id: `compact-${sessionID}` })

          setSessionStatus(sessionID, { type: 'compact' })

          await compactSession(sessionID)
          return true
        }

        case 'undo':
          await onUndo?.()
          return false

        case 'redo':
          await onRedo?.()
          return false

        default: {
          await syncSelection({ sessionID, model, agent: currentAgent })
          await runCommand({
            sessionID,
            name: command.name,
            text: submission.text,
            ...(submission.files ? { files: submission.files } : {}),
            ...(submission.agents ? { agents: submission.agents } : {}),
            ...(submission.skills ? { skills: submission.skills } : {}),
          })
          return true
        }
      }
    } catch (error) {
      showToast.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setSessionStatus(sessionID, { type: 'idle' })
      return false
    } finally {
      setLoading(false)
    }
  }, [sessionID, model, onShowSessionsDialog, onShowModelsDialog, onShowHelpDialog, onToggleDetails, onExportSession, onUndo, onRedo, createSession, navigate, syncSelection, currentAgent, setSessionStatus])

  return {
    executeCommand,
    loading
  }
}
