import { useCallback } from 'react'
import { runCommand } from '@/api/opencode'
import type { PromptAgentInput, PromptFileInput, PromptSkillInput } from '@/api/opencode'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { useSyncSessionSelection } from '@/hooks/useOpenCode'
import { showToast } from '@/lib/toast'
import type { CommandInfo, ModelRef } from '@opencode-manager/shared/opencode'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { isBuiltinCommand, type CommandActions } from '@/lib/builtinCommands'

interface CommandSubmission {
  text: string
  files?: PromptFileInput[]
  agents?: PromptAgentInput[]
  skills?: PromptSkillInput[]
}

interface CommandHandlerProps {
  sessionID: string
  directory?: string
  model?: ModelRef
  currentAgent?: string
  actions: CommandActions
}

export function useCommandHandler({
  sessionID,
  directory,
  model,
  currentAgent,
  actions,
}: CommandHandlerProps) {
  const serverId = useOpenCodeServerId()
  const syncSelection = useSyncSessionSelection(directory)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)

  const executeCommand = useCallback(async (command: CommandInfo, submission: CommandSubmission = { text: '' }): Promise<boolean> => {
    if (isBuiltinCommand(command)) {
      try {
        await actions[command.action](submission.text)
        return !command.keepsPrompt
      } catch (error) {
        showToast.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return false
      }
    }

    try {
      await syncSelection({ sessionID, model, agent: currentAgent })
      await runCommand(
        {
          sessionID,
          name: command.name,
          text: submission.text,
          ...(submission.files ? { files: submission.files } : {}),
          ...(submission.agents ? { agents: submission.agents } : {}),
          ...(submission.skills ? { skills: submission.skills } : {}),
        },
        serverId,
      )
      return true
    } catch (error) {
      showToast.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setSessionStatus(sessionID, { type: 'idle' })
      return false
    }
  }, [actions, sessionID, model, syncSelection, currentAgent, setSessionStatus, serverId])

  return {
    executeCommand
  }
}
