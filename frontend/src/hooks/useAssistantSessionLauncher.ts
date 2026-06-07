import { useCallback } from 'react'
import { OpenCodeClient } from '@/api/opencode'
import type { components } from '@/api/opencode-types'

interface UseAssistantSessionLauncherOptions {
  repoId: number
  opcodeUrl: string
  directory?: string
  onNavigate: (sessionId: string) => void
}

type OpenCodeSession = components['schemas']['Session']

const ASSISTANT_SESSION_LOOKUP_PAGE_SIZE = 25

const LAST_ASSISTANT_SESSION_KEY_PREFIX = 'ocm:assistant:last-session'

function getLastAssistantSessionKey(repoId: number, directory: string): string {
  return `${LAST_ASSISTANT_SESSION_KEY_PREFIX}:${repoId}:${directory}`
}

function setCachedAssistantSessionId(repoId: number, directory: string, sessionId: string): void {
  try {
    localStorage.setItem(getLastAssistantSessionKey(repoId, directory), sessionId)
  } catch {
    return
  }
}

function getCachedAssistantSessionId(repoId: number, directory: string): string | undefined {
  try {
    return localStorage.getItem(getLastAssistantSessionKey(repoId, directory)) ?? undefined
  } catch {
    return undefined
  }
}

function isAssistantRootSession(session: OpenCodeSession, assistantDirectory: string): boolean {
  return !session.parentID && session.directory === assistantDirectory
}

function findNewestRootAssistantSession(sessions: OpenCodeSession[], assistantDirectory: string): OpenCodeSession | undefined {
  return sessions
    .filter((session) => isAssistantRootSession(session, assistantDirectory))
    .sort((a, b) => b.time.updated - a.time.updated)[0]
}

async function getLatestAssistantSession(
  client: OpenCodeClient,
  assistantDirectory: string,
): Promise<OpenCodeSession | undefined> {
  let page = await client.listSessionsPage({ limit: ASSISTANT_SESSION_LOOKUP_PAGE_SIZE, order: 'desc' })
  let latestRootSession = findNewestRootAssistantSession(page.items, assistantDirectory)

  while (!latestRootSession && page.nextCursor) {
    page = await client.listSessionsPage({ cursor: page.nextCursor })
    latestRootSession = findNewestRootAssistantSession(page.items, assistantDirectory)
  }

  return latestRootSession
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
  directory,
  onNavigate,
}: UseAssistantSessionLauncherOptions) {
  const openAssistant = useCallback(async () => {
    if (!directory) {
      throw new Error('Assistant workspace directory is unavailable')
    }

    const cachedSessionId = getCachedAssistantSessionId(repoId, directory)
    if (cachedSessionId) {
      onNavigate(cachedSessionId)
      return
    }

    const client = new OpenCodeClient(opcodeUrl, directory)

    const newest = await getLatestAssistantSession(client, directory)

    if (newest) {
      setCachedAssistantSessionId(repoId, directory, newest.id)
      onNavigate(newest.id)
    } else {
      const session = await client.createSession({ title: 'Assistant' })
      setCachedAssistantSessionId(repoId, directory, session.id)
      onNavigate(session.id)
      void sendAssistantWelcomePrompt(client, session.id)
    }
  }, [repoId, opcodeUrl, directory, onNavigate])

  return { openAssistant }
}
