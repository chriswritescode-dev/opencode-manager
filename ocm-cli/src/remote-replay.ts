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