import { useQuery } from '@tanstack/react-query'
import { OPENCODE_API_ENDPOINT } from '@/config'

interface MessagePart {
  type: string
  text?: string
}

interface SessionMessage {
  info: {
    id: string
    role: string
  }
  parts: MessagePart[]
}

async function fetchFirstUserMessage(sessionId: string, directory?: string): Promise<string | null> {
  const url = new URL(`${OPENCODE_API_ENDPOINT}/session/${sessionId}/message`)
  if (directory) {
    url.searchParams.set('directory', directory)
  }
  
  const response = await fetch(url.toString())
  if (!response.ok) return null
  
  const messages = await response.json() as SessionMessage[]
  
  for (const msg of messages) {
    if (msg.info.role === 'user' && msg.parts?.length > 0) {
      const textPart = msg.parts.find(p => p.type === 'text' && p.text)
      if (textPart?.text) {
        const text = textPart.text.trim()
        return text.length > 120 ? text.slice(0, 117) + '...' : text
      }
    }
  }
  
  return null
}

export function useFirstMessage(sessionId: string | undefined, directory?: string) {
  return useQuery({
    queryKey: ['first-message', sessionId, directory],
    queryFn: () => fetchFirstUserMessage(sessionId!, directory),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
}
