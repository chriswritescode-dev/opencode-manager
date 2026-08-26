import type { Database } from 'bun:sqlite'
import type { GitCredential, Repo } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import {
  findPatCredentialForHost,
  getSSHCredentialsForHost,
  createGitEnv,
  findGitHubCredential,
  type ResolvedGitCredential,
} from '../utils/git-auth'
import { limitForwardedGitConfigs, SANDBOX_MAX_FORWARDED_GIT_CONFIGS } from './sandbox/shell-shim'
import { logger } from '../utils/logger'
import {
  getRepoByDirectory,
  getRepoGitCredentialId,
  getRepoSandboxGitCredentials,
  listRepos,
} from '../db/queries'

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

  getGitEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    const credentials = this.getGitCredentials()
    return createGitEnv(credentials, this.getSelectedCredential(options, credentials))
  }

  isSandboxGitCredentialsAllowed(options: CredentialResolutionOptions = {}): boolean {
    const repo = this.resolveRepo(options)
    if (repo) {
      const repoOverride = getRepoSandboxGitCredentials(this.database, repo.id)
      if (repoOverride !== null) return repoOverride
    }

    return this.settingsService.getSettings('default').preferences.sandbox?.gitCredentials === true
  }

  getSandboxGitEnv(options: CredentialResolutionOptions = {}): Record<string, string> {
    if (!this.isSandboxGitCredentialsAllowed(options)) return {}

    const gitEnv = this.getGitEnv(options)
    if (gitEnv.GIT_CONFIG_COUNT === '0') return {}

    const { env, dropped } = limitForwardedGitConfigs(gitEnv)
    if (dropped > 0) {
      logger.warn(
        `Sandbox git credentials exceed the forwarding limit of ${SANDBOX_MAX_FORWARDED_GIT_CONFIGS} hosts; ${dropped} host(s) will not authenticate inside the microVM`,
      )
    }

    return { ...env, ...this.getGhCliEnv(options) }
  }

  private resolveRepo(options: CredentialResolutionOptions): Repo | null {
    if (options.repoId !== undefined) {
      return listRepos(this.database).find((repo) => repo.id === options.repoId) ?? null
    }
    return options.cwd ? getRepoByDirectory(this.database, options.cwd) : null
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
    const repo = this.resolveRepo(options)
    if (!repo) return null

    const credentialId = getRepoGitCredentialId(this.database, repo.id)
    return credentials.find((credential) => credential.id === credentialId) ?? null
  }

  private isGithubPatCredential(credential: GitCredential | null): credential is GitCredential {
    return !!credential && credential.type !== 'ssh' && findGitHubCredential([credential]) === credential
  }
}
