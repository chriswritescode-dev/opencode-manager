import type { Database } from 'bun:sqlite'
import type { GitCredential } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import {
  findPatCredentialForHost,
  getSSHCredentialsForHost,
  findGitHubCredential,
  createGhCliEnv,
  type ResolvedGitCredential,
} from '../utils/git-auth'

export class CredentialProvider {
  private settingsService: SettingsService

  constructor(database: Database) {
    this.settingsService = new SettingsService(database)
  }

  getGitCredentials(): GitCredential[] {
    const settings = this.settingsService.getSettings('default')
    return (settings.preferences.gitCredentials || []) as GitCredential[]
  }

  getPatCredentialForHost(hostname: string): ResolvedGitCredential | null {
    return findPatCredentialForHost(this.getGitCredentials(), hostname)
  }

  getSshCredentialsForHost(host: string): GitCredential[] {
    return getSSHCredentialsForHost(this.getGitCredentials(), host)
  }

  getGitHubCredential(): GitCredential | null {
    return findGitHubCredential(this.getGitCredentials())
  }

  getGhCliEnv(): Record<string, string> {
    return createGhCliEnv(this.getGitCredentials())
  }
}
