import { useCallback } from 'react'
import { initializeAssistantMode } from '@/api/repos'
import { OpenCodeClient } from '@/api/opencode'

interface UseAssistantSessionLauncherOptions {
  repoId: number
  opcodeUrl: string
  onNavigate: (sessionId: string) => void
}

const ASSISTANT_WELCOME_PROMPT = `Welcome to OpenCode Manager! I'm your assistant and I'm here to help you work with your code.

To get started, let's set up your assistant:

**1. Name your assistant**
What would you like to call me? This name will help personalize our interactions.

**2. Review AGENTS.md**
AGENTS.md contains workspace-level instructions, durable preferences, and self-editing rules.

**3. Review the assistant agent**
.opencode/agents/assistant.md defines the default Assistant Mode agent and can be customized later.

**4. Use workspace skills**
Skills for repos, schedules, notifications, and settings are available under .opencode/skills/.

Take your time exploring and customizing these settings. Let me know when you're ready to start coding, or if you have any questions about getting set up!`

async function sendAssistantWelcomePrompt(client: OpenCodeClient, sessionId: string): Promise<void> {
  await client.sendPromptAsync(sessionId, {
    parts: [
      {
        type: 'text',
        text: ASSISTANT_WELCOME_PROMPT,
      },
    ],
  }).catch(() => undefined)
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
      onNavigate(session.id)
      void sendAssistantWelcomePrompt(client, session.id)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
