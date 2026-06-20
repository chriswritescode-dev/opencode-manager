import type { Database } from 'bun:sqlite'
import type { GitCredential } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import {
  findPatCredentialForHost,
  getSSHCredentialsForHost,
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

  getGhCliEnv(): Record<string, string> {
    return createGhCliEnv(this.getGitCredentials())
  }
}
