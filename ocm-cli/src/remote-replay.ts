import type { ReplayEvent } from './session-move.js'

export function createManagerReplay(managerUrl: string, token: string) {
  return async (remoteDirectory: string, events: ReplayEvent[]): Promise<{ sessionID: string }> => {
    const url = `${managerUrl}/api/opencode-proxy/sync/replay?directory=${encodeURIComponent(remoteDirectory)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: remoteDirectory, events }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`replay failed (${res.status}): ${text.slice(0, 200)}`)
    }

    return (await res.json()) as { sessionID: string }
  }
}

export function createManagerPromptAsync(managerUrl: string, token: string) {
  return async (remoteDirectory: string, sessionID: string, text: string): Promise<void> => {
    const url = `${managerUrl}/api/opencode-proxy/session/${encodeURIComponent(sessionID)}/prompt_async?directory=${encodeURIComponent(remoteDirectory)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ noReply: true, parts: [{ type: 'text', text, synthetic: true }] }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`prompt_async failed (${res.status}): ${body.slice(0, 200)}`)
    }
  }
}