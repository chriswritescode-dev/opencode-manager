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
      onNavigate(session.id)
    }
  }, [repoId, opcodeUrl, onNavigate])

  return { openAssistant }
}
