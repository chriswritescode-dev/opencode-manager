import { useCallback } from 'react'
import { initializeAssistantMode } from '@/api/repos'
import { OpenCodeClient } from '@/api/opencode'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'

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
AGENTS.md explains the assistant workspace directory and points to the files OpenCode Manager manages.

**3. Review the assistant agent**
.opencode/agents/assistant.md contains the default Assistant Mode agent instructions, durable preferences, self-editing rules, and skill guidance.

**4. Use workspace skills**
.opencode/skills/ contains managed workspace skills for repos, schedules, notifications, and settings.

Take your time exploring and customizing these settings. Let me know when you're ready to start coding, or if you have any questions about getting set up!`

function buildAssistantModeWarningsPrompt(assistant: AssistantModeStatus): string | undefined {
  if (!assistant.warnings?.length) return undefined

  return [
    'Assistant Mode was updated, but some generated instruction changes were not applied.',
    '',
    ...assistant.warnings.map((warning) => `- ${warning.message}`),
  ].join('\n')
}

function buildAssistantWelcomePrompt(assistant: AssistantModeStatus): string {
  const warningsPrompt = buildAssistantModeWarningsPrompt(assistant)
  return warningsPrompt
    ? `${ASSISTANT_WELCOME_PROMPT}\n\n${warningsPrompt}`
    : ASSISTANT_WELCOME_PROMPT
}

async function sendAssistantWelcomePrompt(client: OpenCodeClient, sessionId: string, assistant: AssistantModeStatus): Promise<void> {
  await client.sendPromptAsync(sessionId, {
    parts: [
      {
        type: 'text',
        text: buildAssistantWelcomePrompt(assistant),
      },
    ],
  }).catch(() => undefined)
}

async function sendAssistantModeWarningsPrompt(client: OpenCodeClient, sessionId: string, assistant: AssistantModeStatus): Promise<void> {
  const warningsPrompt = buildAssistantModeWarningsPrompt(assistant)
  if (!warningsPrompt) return

  await client.sendPromptAsync(sessionId, {
    parts: [
      {
        type: 'text',
        text: warningsPrompt,
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
      void sendAssistantModeWarningsPrompt(client, newest.id, assistant)
    } else {
      const session = await client.createSession({ title: 'Assistant' })
      onNavigate(session.id)
      void sendAssistantWelcomePrompt(client, session.id, assistant)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
