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

  private normalizeHostname(host: string): string {
    let normalized = host.toLowerCase().trim()
    normalized = normalized.replace(/\/+$/, '')
    
    if (!normalized.includes('://')) {
      normalized = 'https://' + normalized
    }
    
    try {
      const parsed = new URL(normalized)
      return parsed.hostname
    } catch {
      const stripped = normalized.replace(/^https?:\/\//, '')
      return stripped.split('/')[0] || stripped
    }
  }

  private async getCredentialsForHost(hostname: string): Promise<Credentials | null> {
    const normalizedRequest = this.normalizeHostname(hostname)
    logger.info(`Looking up credentials for host: ${hostname} (normalized: ${normalizedRequest})`)
    
    const settingsService = new SettingsService(this.database)
    const settings = settingsService.getSettings('default')
    const gitCredentials: GitCredential[] = settings.preferences.gitCredentials || []
    logger.info(`Found ${gitCredentials.length} configured git credentials`)

    for (const cred of gitCredentials) {
      const normalizedCred = this.normalizeHostname(cred.host)
      logger.debug(`Comparing: request='${normalizedRequest}' vs stored='${normalizedCred}' (raw: ${cred.host})`)
      
      if (normalizedCred === normalizedRequest) {
        logger.info(`Found matching credential '${cred.name}' for ${hostname}`)
        return {
          username: cred.username || this.getDefaultUsername(cred.host),
          password: cred.token,
        }
      }
    }
    
    if (gitCredentials.length > 0) {
      logger.warn(`No credentials found for host: ${hostname}. Configured hosts: ${gitCredentials.map(c => c.host).join(', ')}`)
    } else {
      logger.warn(`No credentials found for host: ${hostname}. No git credentials configured.`)
    }
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
