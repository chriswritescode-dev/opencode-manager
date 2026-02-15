import type { IPCServer } from '../ipc/ipcServer'
import type { Database } from 'bun:sqlite'
import { AskpassHandler } from '../ipc/askpassHandler'
import { SSHHostKeyHandler } from '../ipc/sshHostKeyHandler'
import { writeTemporarySSHKey, buildSSHCommand, buildSSHCommandWithKnownHosts, cleanupSSHKey, parseSSHHost } from '../utils/ssh-key-manager'
import { decryptSecret } from '../utils/crypto'
import { isSSHUrl, normalizeSSHUrl, extractHostFromSSHUrl, getSSHCredentialsForHost } from '../utils/git-auth'
import type { GitCredential } from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import { SettingsService } from './settings'

export class GitAuthService {
  private askpassHandler: AskpassHandler | null = null
  public sshHostKeyHandler: SSHHostKeyHandler | null = null
  private sshKeyPath: string | null = null
  private sshPassphrase: string | null = null
  private sshPort: string | null = null

  async initialize(ipcServer: IPCServer | undefined, database: Database): Promise<void> {
    this.askpassHandler = new AskpassHandler(ipcServer, database)
    this.sshHostKeyHandler = new SSHHostKeyHandler(database, 120_000)
    await this.sshHostKeyHandler.initialize()

    if (ipcServer) {
      const handlerPath = 'ssh-host-key'
      ipcServer.registerHandler(handlerPath, this.sshHostKeyHandler)
      logger.info(`SSH host key handler registered with IPC server at /${handlerPath}`)
    }
  }

  async setupSSHKey(credential: GitCredential): Promise<void> {
    if (credential.type !== 'ssh' || !credential.sshPrivateKeyEncrypted) {
      return
    }

    try {
      const privateKey = decryptSecret(credential.sshPrivateKeyEncrypted)
      this.sshKeyPath = await writeTemporarySSHKey(privateKey, credential.name)

      if (credential.passphrase) {
        this.sshPassphrase = decryptSecret(credential.passphrase)
        logger.info(`SSH key with passphrase created for ${credential.name}: ${this.sshKeyPath}`)
      } else {
        this.sshPassphrase = null
        logger.info(`SSH key created for ${credential.name}: ${this.sshKeyPath}`)
      }
    } catch (error) {
      logger.error(`Failed to setup SSH key for ${credential.name}:`, error)
      throw error
    }
  }

  setSSHPort(port: string | null): void {
    this.sshPort = port
  }

  getSSHEnvironment(): Record<string, string> {
    const knownHostsPath = this.sshHostKeyHandler?.getKnownHostsPath()
    const port = this.sshPort || undefined
    
    if (!this.sshKeyPath) {
      if (knownHostsPath) {
        const sshCommand = buildSSHCommandWithKnownHosts(knownHostsPath, port)
        logger.info(`SSH environment: Using known_hosts=${knownHostsPath}, SSH_COMMAND=${sshCommand}`)
        return {
          GIT_SSH_COMMAND: sshCommand,
          ...(this.sshHostKeyHandler?.getEnv() || {}),
        }
      }
      logger.info(`SSH environment: No SSH key and no known_hosts path, returning host key handler env only`)
      return {
        ...(this.sshHostKeyHandler?.getEnv() || {}),
      }
    }

    const sshResult = buildSSHCommand(this.sshKeyPath, this.sshPassphrase || undefined, knownHostsPath, port)
    logger.info(`SSH environment: Using SSH key=${this.sshKeyPath}, known_hosts=${knownHostsPath}, SSH_COMMAND=${sshResult.command}`)
    return {
      GIT_SSH_COMMAND: sshResult.command,
      ...(sshResult.env || {}),
      ...(this.sshHostKeyHandler?.getEnv() || {}),
    }
  }

  async setupSSHForRepoUrl(repoUrl: string | undefined, database: Database, skipSSHVerification: boolean = false): Promise<boolean> {
    if (!repoUrl || !isSSHUrl(repoUrl)) {
      return false
    }

    const normalizedUrl = normalizeSSHUrl(repoUrl)
    const sshHost = extractHostFromSSHUrl(normalizedUrl)
    if (!sshHost) {
      logger.warn(`Could not extract SSH host from URL: ${repoUrl}`)
      return false
    }

    const { port } = parseSSHHost(normalizedUrl)
    this.setSSHPort(port && port !== '22' ? port : null)

    const settingsService = new SettingsService(database)
    const settings = settingsService.getSettings('default')
    const gitCredentials = (settings.preferences.gitCredentials || []) as GitCredential[]
    const sshCredentials = getSSHCredentialsForHost(gitCredentials, sshHost)

    if (sshCredentials.length > 0 && sshCredentials[0]) {
      try {
        await this.setupSSHKey(sshCredentials[0])
      } catch (error) {
        logger.error(`Failed to setup SSH key for ${sshHost}:`, error)
        throw new Error(`Failed to setup SSH authentication: ${error}`)
      }
    }

    if (skipSSHVerification) {
      logger.info(`Skipping SSH host key verification for ${sshHost} (user requested)`)
      try {
        await this.autoAcceptHostKey(normalizedUrl)
      } catch (error) {
        await this.cleanupSSHKey()
        throw new Error(`Failed to auto-accept SSH host key for ${sshHost}: ${(error as Error).message}`)
      }
    } else {
      const verified = await this.verifyHostKeyBeforeOperation(normalizedUrl)
      if (!verified) {
        await this.cleanupSSHKey()
        throw new Error('SSH host key verification failed or was rejected by user')
      }
    }

    return sshCredentials.length > 0
  }

  async verifyHostKeyBeforeOperation(repoUrl: string): Promise<boolean> {
    if (!this.sshHostKeyHandler) {
      return true
    }
    return this.sshHostKeyHandler.verifyHostKeyBeforeOperation(repoUrl)
  }

  async autoAcceptHostKey(repoUrl: string): Promise<void> {
    if (!this.sshHostKeyHandler) {
      logger.warn('SSH host key handler not initialized, skipping auto-accept')
      return
    }
    await this.sshHostKeyHandler.autoAcceptHostKey(repoUrl)
  }

  async cleanupSSHKey(): Promise<void> {
    if (this.sshKeyPath) {
      await cleanupSSHKey(this.sshKeyPath)
      this.sshKeyPath = null
      this.sshPassphrase = null
      this.sshPort = null
      logger.info('SSH key cleaned up')
    }
  }

  getGitEnvironment(silent: boolean = false): Record<string, string> {
    const env: Record<string, string> = {
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    }

    if (silent) {
      env.VSCODE_GIT_FETCH_SILENT = 'true'
    }

    if (this.askpassHandler) {
      Object.assign(env, this.askpassHandler.getEnv())
    }

    return env
  }
}
