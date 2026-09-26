import { createOpenCodeApi, isSessionNotFoundError } from '@opencode-manager/shared/opencode'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'
import { repoProxyBaseUrl } from './repo-proxy.js'

export type ManagerSessionTransfer = ReturnType<typeof createManagerSessionTransfer>

export function createManagerSessionTransfer(managerUrl: string, token: string) {
  const api = createOpenCodeApi({
    baseUrl: repoProxyBaseUrl(managerUrl),
    password: token,
  })

  return {
    sessionExists: async (sessionID: string): Promise<boolean> => {
      try {
        await api.session.get({ sessionID })
        return true
      } catch (err) {
        if (isSessionNotFoundError(err)) return false
        throw err
      }
    },
    importSession: async (remoteDirectory: string, data: SessionTransferData): Promise<{ sessionID: string }> => {
      const session = await api.session.import({
        info: data.info,
        messages: data.messages,
        location: { directory: remoteDirectory },
      })
      return { sessionID: session.id }
    },
    addReminder: (sessionID: string, text: string) => api.session.synthetic({ sessionID, text, resume: false }),
  }
}
