import { createOpenCodeApi } from '@opencode-manager/shared/opencode'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'

export function createManagerSessionTransfer(managerUrl: string, token: string) {
  const api = createOpenCodeApi({
    baseUrl: `${managerUrl}/api/opencode-proxy`,
    password: token,
  })

  return {
    importSession: async (remoteDirectory: string, data: SessionTransferData): Promise<{ sessionID: string }> => {
      const session = await api.session.import({
        info: data.info,
        messages: data.messages,
        location: { directory: remoteDirectory },
      })
      return { sessionID: session.id }
    },
    addReminder: (sessionID: string, text: string) => api.session.synthetic({ sessionID, text }),
  }
}
