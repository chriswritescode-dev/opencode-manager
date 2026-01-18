import * as path from 'path'
import { fileURLToPath } from 'url'
import type { IPCServer, IPCHandler } from './ipcServer'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import type { GitCredential } from '../utils/git-auth'

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
      VSCODE_GIT_ASKPASS_MAIN: path.join(scriptsDir, 'askpass-main.js'),
    }

    if (this.ipcServer) {
      this.ipcServer.registerHandler('askpass', this)
    }
  }

  async handle(request: AskpassRequest): Promise<string> {
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
    const settingsService = new SettingsService(this.database)
    const settings = settingsService.getSettings('default')
    const gitCredentials: GitCredential[] = settings.preferences.gitCredentials || []

    for (const cred of gitCredentials) {
      try {
        const parsed = new URL(cred.host)
        if (parsed.hostname.toLowerCase() === hostname.toLowerCase()) {
          return {
            username: cred.username || this.getDefaultUsername(cred.host),
            password: cred.token,
          }
        }
      } catch {
        if (cred.host.toLowerCase().includes(hostname.toLowerCase())) {
          return {
            username: cred.username || 'oauth2',
            password: cred.token,
          }
        }
      }
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
