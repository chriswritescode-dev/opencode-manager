import { useCallback } from 'react'
import { initializeAssistantMode } from '@/api/repos'
import { OpenCodeClient } from '@/api/opencode'

interface UseAssistantSessionLauncherOptions {
  repoId: number
  opcodeUrl: string
  onNavigate: (sessionId: string) => void
}

export function useAssistantSessionLauncher({
  repoId,
  opcodeUrl,
  onNavigate,
}: UseAssistantSessionLauncherOptions) {
  const openAssistant = useCallback(async () => {
    const assistant = await initializeAssistantMode(repoId)
    const client = new OpenCodeClient(opcodeUrl, assistant.directory)
    const sessions = await client.listSessions()

    const assistantDirectory = assistant.directory

    const rootSessions = sessions.filter(
      (session) => !session.parentID
    )

    const assistantSessions = rootSessions.filter(
      (session) => session.directory === assistantDirectory
    )

    const newest = assistantSessions.sort(
      (a, b) => b.time.updated - a.time.updated
    )[0]

    if (newest) {
      onNavigate(newest.id)
    } else {
      const session = await client.createSession({ title: 'Assistant' })
      await client.sendPrompt(session.id, {
        parts: [
          {
            type: 'text',
            text: `Welcome to the OpenCode Manager Assistant workspace.

This chat is running from the shared Assistant directory. Use it to customize how I behave across OpenCode Manager sessions without changing any project repository.

Start here:

**1. Review AGENTS.md**
This file contains durable instructions, preferences, and working agreements for this Assistant workspace.

**2. Review opencode.json**
This file controls the OpenCode configuration for this workspace, including permissions and Assistant-specific settings.

**3. Use the update-configuration skill**
When you want me to change Assistant instructions, workspace config, or Assistant-scoped skills, ask me to use the update-configuration skill. I will make the smallest safe edit, preserve your customizations, validate config, and reload OpenCode when needed.

Tell me what you want this Assistant workspace to remember or how you want it customized.`,
          },
        ],
      })
      onNavigate(session.id)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
