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
            text: `Welcome to OpenCode Manager! I'm your assistant and I'm here to help you work with your code.

To get started, let's set up your assistant:

**1. Name your assistant**
What would you like to call me? This name will help personalize our interactions.

**2. Configure AGENTS.md**
This file contains instructions that define my behavior, persona, and preferences. You can customize it to match your workflow. Take a moment to review and edit it - you can always adjust it later.

**3. Set up your v file (optional)**
The v file stores conversation state and context between sessions. This helps me maintain memory of our work together.

Take your time exploring and customizing these settings. Let me know when you're ready to start coding, or if you have any questions about getting set up!`,
          },
        ],
      })
      onNavigate(session.id)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
