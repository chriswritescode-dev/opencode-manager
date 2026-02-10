import type { IPCServer, IPCHandler } from './ipcServer'
import { logger } from '../utils/logger'

interface PassphraseResponse {
  type: 'passphrase-response'
  passphrase: string
}

export class PassphraseHandler implements IPCHandler {
  private resolveMap = new Map<string, { resolve: (passphrase: string) => void; reject: (error: Error) => void }>()

  constructor(ipcServer: IPCServer | undefined) {
    if (ipcServer) {
      ipcServer.registerHandler('passphrase', this)
      logger.info('PassphraseHandler registered with IPC server')
    } else {
      logger.warn('PassphraseHandler: No IPC server provided, passphrase prompts will fail')
    }
  }

  async handle(request: PassphraseResponse): Promise<string> {
    if (request.type === 'passphrase-response') {
      const pending = this.resolveMap.get('default')
      if (pending) {
        pending.resolve(request.passphrase)
        this.resolveMap.delete('default')
      }
      return 'ack'
    }
    return ''
  }

  requestPassphrase(credentialName: string, host: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = `default`

      this.resolveMap.set(requestId, { resolve, reject })

      logger.info(`Requesting passphrase for ${credentialName} (${host})`)

      setTimeout(() => {
        if (this.resolveMap.has(requestId)) {
          this.resolveMap.delete(requestId)
          reject(new Error('Passphrase request timed out'))
        }
      }, 120000)
    })
  }

  cleanup(): void {
    this.resolveMap.forEach(({ reject }) => reject(new Error('Passphrase handler closed')))
    this.resolveMap.clear()
  }
}
