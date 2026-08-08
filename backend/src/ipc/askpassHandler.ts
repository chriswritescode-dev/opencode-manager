import * as path from 'path'
import { fileURLToPath } from 'url'
import type { IPCServer, IPCHandler } from './ipcServer'
import { CredentialProvider } from '../services/credential-provider'
import { logger } from '../utils/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Credentials {
  username: string
  password: string
}

interface AskpassRequest {
  askpassType: 'https' | 'ssh'
  argv: string[]
  cwd?: string
  repoId?: number
}

export class AskpassHandler implements IPCHandler {
  private cache = new Map<string, Credentials>()
  private env: Record<string, string>

  constructor(
    private ipcServer: IPCServer | undefined,
    private credentialProvider: CredentialProvider
  ) {
    const scriptsDir = path.join(__dirname, '../../scripts')

    this.env = {
      GIT_ASKPASS: path.join(scriptsDir, this.ipcServer ? 'askpass.sh' : 'askpass-empty.sh'),
      VSCODE_GIT_ASKPASS_NODE: process.execPath,
      VSCODE_GIT_ASKPASS_EXTRA_ARGS: '',
      VSCODE_GIT_ASKPASS_MAIN: path.join(scriptsDir, 'askpass-main.ts'),
    }

    logger.info(`AskpassHandler initialized: execPath=${process.execPath}, GIT_ASKPASS=${this.env.GIT_ASKPASS}, VSCODE_GIT_ASKPASS_NODE=${this.env.VSCODE_GIT_ASKPASS_NODE}, VSCODE_GIT_ASKPASS_MAIN=${this.env.VSCODE_GIT_ASKPASS_MAIN}`)

    if (this.ipcServer) {
      this.ipcServer.registerHandler('askpass', this)
      logger.info('AskpassHandler registered with IPC server')
    } else {
      logger.warn('AskpassHandler: No IPC server provided, using empty askpass')
    }
  }

  async handle(request: AskpassRequest): Promise<string> {
    logger.info(`Askpass request received: type=${request.askpassType}, argv=${JSON.stringify(request.argv)}`)
    if (request.askpassType === 'https') {
      return this.handleHttpsAskpass(request)
    }
    return this.handleSshAskpass()
  }

  private async handleHttpsAskpass(request: AskpassRequest): Promise<string> {
    const { argv } = request
    const prompt = argv[2] || ''
    const host = argv[4]?.replace(/^["']+|["':]+$/g, '') || ''

    let authority = ''
    try {
      const uri = new URL(host)
      authority = uri.hostname
    } catch {
      authority = host
    }

    const isPassword = /password/i.test(prompt)

    const cacheKey = `${authority}:${request.repoId ?? ''}:${request.cwd ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && isPassword) {
      this.cache.delete(cacheKey)
      return cached.password
    }

    const credentials = this.credentialProvider.getPatCredentialForHost(authority, {
      cwd: request.cwd,
      repoId: request.repoId,
    })
    if (credentials) {
      this.cache.set(cacheKey, credentials)
      setTimeout(() => this.cache.delete(cacheKey), 60_000)
      return isPassword ? credentials.password : credentials.username
    }

    return ''
  }

  private async handleSshAskpass(): Promise<string> {
    return ''
  }

  getEnv(): Record<string, string> {
    return {
      ...this.env,
      ...(this.ipcServer?.getEnv() || {}),
    }
  }
}
