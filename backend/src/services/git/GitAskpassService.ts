import { SettingsService } from '../../services/settings'
import type { Database } from 'bun:sqlite'
import { getCredentialForHost, getDefaultUsername } from '../../utils/git-auth'
import path from 'path'

interface CachedCredential {
  token: string
  timestamp: number
}

export class GitAskpassService {
  private cache = new Map<string, CachedCredential>()
  private readonly cacheTtl = 60000 // 60s

  async getCredential(prompt: string, cwd: string, database: Database): Promise<string> {
    // Parse host from prompt
    const hostMatch = prompt.match(/https?:\/\/([^'"]+)/)
    if (!hostMatch || !hostMatch[1]) {
      return ''
    }
    const host = hostMatch[1].split('/')[0]

    // Check cache
    const cached = this.cache.get(host)
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.token
    }

    // Find repo from cwd
    const repo = await this.findRepoByCwd(cwd, database)
    if (!repo) {
      return ''
    }

    // Get credentials
    const settingsService = new SettingsService(database)
    const settings = settingsService.getSettings('default')
    const gitCredentials = settings.preferences.gitCredentials || []

    const credential = getCredentialForHost(gitCredentials, host)
    if (!credential || !credential.token || !credential.host) {
      return ''
    }

    const username = credential.username || getDefaultUsername(credential.host!)

    // Cache
    this.cache.set(host, { token: credential.token, timestamp: Date.now() })

    return credential.token
  }

  private async findRepoByCwd(cwd: string, database: Database) {
    const repos = database.query('SELECT * FROM repos').all() as any[]
    for (const repo of repos) {
      if (path.resolve(repo.fullPath) === path.resolve(cwd)) {
        return repo
      }
    }
    return null
  }
}