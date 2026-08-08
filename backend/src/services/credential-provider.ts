import type { Database } from 'bun:sqlite'
import type { GitCredential } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import {
  findPatCredentialForHost,
  getSSHCredentialsForHost,
  createGitEnv,
  findGitHubCredential,
  type ResolvedGitCredential,
} from '../utils/git-auth'
import { getRepoByDirectory, getRepoGitCredentialId } from '../db/queries'

interface CredentialResolutionOptions {
  cwd?: string
  repoId?: number
}

export class CredentialProvider {
  private settingsService: SettingsService
  private database: Database

  constructor(database: Database) {
    this.database = database
    this.settingsService = new SettingsService(database)
  }

  getGitCredentials(): GitCredential[] {
    const settings = this.settingsService.getSettings('default')
    return (settings.preferences.gitCredentials || []) as GitCredential[]
  }

  getGitCredentialById(credentialId: string | undefined): GitCredential | null {
    if (!credentialId) return null
    return this.getGitCredentials().find((credential) => credential.id === credentialId) ?? null
  }

  getPatCredentialForHost(hostname: string, options: CredentialResolutionOptions = {}): ResolvedGitCredential | null {
    const credentials = this.getGitCredentials()
    const selectedCredential = this.getSelectedCredential(options, credentials)
    const selectedMatch = selectedCredential ? findPatCredentialForHost([selectedCredential], hostname) : null
    return selectedMatch ?? findPatCredentialForHost(credentials, hostname)
  }

  getSshCredentialsForHost(host: string): GitCredential[] {
    return getSSHCredentialsForHost(this.getGitCredentials(), host)
  }

  getSshCredentialsWithPrivateKey(): GitCredential[] {
    return this.getGitCredentials().filter((cred) => cred.type === 'ssh' && cred.sshPrivateKeyEncrypted)
  }

  getGitEnv(): Record<string, string> {
    return createGitEnv(this.getGitCredentials())
  }

  getGhCliEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    const credential = this.getGhCliCredential(options)
    if (!credential?.token) return {}
    return { GH_TOKEN: credential.token, GITHUB_TOKEN: credential.token }
  }

  private getGhCliCredential(options: CredentialResolutionOptions): GitCredential | null {
    const credentials = this.getGitCredentials()
    const selectedCredential = this.getSelectedCredential(options, credentials)
    if (this.isGithubPatCredential(selectedCredential)) return selectedCredential

    return findGitHubCredential(credentials)
  }

  private getSelectedCredential(options: CredentialResolutionOptions, credentials: GitCredential[]): GitCredential | null {
    const repoCredential = this.getRepoCredential(options, credentials)
    if (repoCredential) return repoCredential

    const settings = this.settingsService.getSettings('default')
    return credentials.find((credential) => credential.id === settings.preferences.defaultGitCredentialId) ?? null
  }

  private getRepoCredential(options: CredentialResolutionOptions, credentials: GitCredential[]): GitCredential | null {
    const repoId = options.repoId ?? (options.cwd ? getRepoByDirectory(this.database, options.cwd)?.id : undefined)
    if (!repoId) return null

    const credentialId = getRepoGitCredentialId(this.database, repoId)
    return credentials.find((credential) => credential.id === credentialId) ?? null
  }

  private isGithubPatCredential(credential: GitCredential | null): credential is GitCredential {
    return !!credential && credential.type !== 'ssh' && findGitHubCredential([credential]) === credential
  }
}
