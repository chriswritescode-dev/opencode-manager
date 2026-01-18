import * as path from 'path'
import { fileURLToPath } from 'url'
import type { IPCServer, IPCHandler } from './ipcServer'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import type { GitCredential } from '../utils/git-auth'
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
}

export class AskpassHandler implements IPCHandler {
  private cache = new Map<string, Credentials>()
  private env: Record<string, string>

  constructor(
    private ipcServer: IPCServer | undefined,
    private database: Database
  ) {
    const scriptsDir = path.join(__dirname, '../../scripts')

    this.env = {
      GIT_ASKPASS: path.join(scriptsDir, this.ipcServer ? 'askpass.sh' : 'askpass-empty.sh'),
      VSCODE_GIT_ASKPASS_NODE: process.execPath,
      VSCODE_GIT_ASKPASS_EXTRA_ARGS: '',
      VSCODE_GIT_ASKPASS_MAIN: path.join(scriptsDir, 'askpass-main.ts'),
    }

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
      return this.handleHttpsAskpass(request.argv)
    }
    return this.handleSshAskpass()
  }

  private async handleHttpsAskpass(argv: string[]): Promise<string> {
    const request = argv[2] || ''
    const host = argv[4]?.replace(/^["']+|["':]+$/g, '') || ''

    let authority = ''
    try {
      const uri = new URL(host)
      authority = uri.hostname
    } catch {
      authority = host
    }

    const isPassword = /password/i.test(request)

    const cached = this.cache.get(authority)
    if (cached && isPassword) {
      this.cache.delete(authority)
      return cached.password
    }

    const credentials = await this.getCredentialsForHost(authority)
    if (credentials) {
      this.cache.set(authority, credentials)
      setTimeout(() => this.cache.delete(authority), 60_000)
      return isPassword ? credentials.password : credentials.username
    }

    return ''
  }

  private async handleSshAskpass(): Promise<string> {
    return ''
  }

  private async getCredentialsForHost(hostname: string): Promise<Credentials | null> {
    logger.info(`Looking up credentials for host: ${hostname}`)
    const settingsService = new SettingsService(this.database)
    const settings = settingsService.getSettings('default')
    const gitCredentials: GitCredential[] = settings.preferences.gitCredentials || []
    logger.info(`Found ${gitCredentials.length} configured git credentials`)

    for (const cred of gitCredentials) {
      try {
        const parsed = new URL(cred.host)
        if (parsed.hostname.toLowerCase() === hostname.toLowerCase()) {
          logger.info(`Found matching credential for ${hostname}`)
          return {
            username: cred.username || this.getDefaultUsername(cred.host),
            password: cred.token,
          }
        }
      } catch {
        if (cred.host.toLowerCase().includes(hostname.toLowerCase())) {
          logger.info(`Found matching credential (fuzzy match) for ${hostname}`)
          return {
            username: cred.username || 'oauth2',
            password: cred.token,
          }
        }
      }
    }
    logger.warn(`No credentials found for host: ${hostname}`)
    return null
  }

  private getDefaultUsername(host: string): string {
    try {
      const parsed = new URL(host)
      const hostname = parsed.hostname.toLowerCase()

      if (hostname === 'github.com') {
        return 'x-access-token'
      }
      if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
        return 'oauth2'
      }
      return 'oauth2'
    } catch {
      return 'oauth2'
    }
  }

  getEnv(): Record<string, string> {
    return {
      ...this.env,
      ...(this.ipcServer?.getEnv() || {}),
    }
  }
}
