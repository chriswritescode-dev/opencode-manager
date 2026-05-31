import { useCallback } from 'react'
import { initializeAssistantMode } from '@/api/repos'
import { OpenCodeClient } from '@/api/opencode'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'
import type { components } from '@/api/opencode-types'

interface UseAssistantSessionLauncherOptions {
  repoId: number
  opcodeUrl: string
  onNavigate: (sessionId: string) => void
}

type OpenCodeSession = components['schemas']['Session']

const LAST_ASSISTANT_SESSION_KEY_PREFIX = 'ocm:assistant:last-session'

function getLastAssistantSessionKey(repoId: number, directory: string): string {
  return `${LAST_ASSISTANT_SESSION_KEY_PREFIX}:${repoId}:${directory}`
}

function getCachedAssistantSessionId(repoId: number, directory: string): string | undefined {
  try {
    return localStorage.getItem(getLastAssistantSessionKey(repoId, directory)) || undefined
  } catch {
    return undefined
  }
}

function setCachedAssistantSessionId(repoId: number, directory: string, sessionId: string): void {
  try {
    localStorage.setItem(getLastAssistantSessionKey(repoId, directory), sessionId)
  } catch {
    return
  }
}

function removeCachedAssistantSessionId(repoId: number, directory: string): void {
  try {
    localStorage.removeItem(getLastAssistantSessionKey(repoId, directory))
  } catch {
    return
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

async function getCachedAssistantSession(
  client: OpenCodeClient,
  repoId: number,
  assistantDirectory: string,
): Promise<OpenCodeSession | undefined> {
  const cachedSessionId = getCachedAssistantSessionId(repoId, assistantDirectory)
  if (!cachedSessionId) return undefined

  try {
    const session = await client.getSession(cachedSessionId)
    if (isAssistantRootSession(session, assistantDirectory)) return session
    removeCachedAssistantSessionId(repoId, assistantDirectory)
  } catch {
    removeCachedAssistantSessionId(repoId, assistantDirectory)
  }

  return undefined
}

async function getLatestAssistantSession(
  client: OpenCodeClient,
  assistantDirectory: string,
): Promise<OpenCodeSession | undefined> {
  const latestSessions = await client.listSessions({ limit: 1, roots: true })
  const latestRootSession = findNewestRootAssistantSession(latestSessions, assistantDirectory)
  if (latestRootSession || latestSessions.length === 0) return latestRootSession

  const sessions = await client.listSessions()
  return findNewestRootAssistantSession(sessions, assistantDirectory)
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
    const assistantDirectory = assistant.directory

    const newest = await getCachedAssistantSession(client, repoId, assistantDirectory)
      ?? await getLatestAssistantSession(client, assistantDirectory)

    if (newest) {
      setCachedAssistantSessionId(repoId, assistantDirectory, newest.id)
      onNavigate(newest.id)
      void sendAssistantModeWarningsPrompt(client, newest.id, assistant)
    } else {
      const session = await client.createSession({ title: 'Assistant' })
      setCachedAssistantSessionId(repoId, assistantDirectory, session.id)
      onNavigate(session.id)
      void sendAssistantWelcomePrompt(client, session.id, assistant)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
