import { SettingsService } from './settings'
import type { Database } from 'bun:sqlite'
import { executeCommand } from '../utils/process'
import { getRepoById } from '../db/queries'
import path from 'path'
import { createNoPromptGitEnv, getCredentialForHost, getDefaultUsername, normalizeHost } from '../utils/git-auth'

export class GitAuthService {
  async getGitEnvironment(repoId: number, database: Database): Promise<Record<string, string>> {
    try {
      const settingsService = new SettingsService(database)
      const settings = settingsService.getSettings('default')
      const gitCredentials = settings.preferences.gitCredentials || []

      // Get repo host
      const repo = getRepoById(database, repoId)
      if (!repo) {
        return createNoPromptGitEnv()
      }

      const fullPath = path.resolve(repo.fullPath)
      const remoteUrl = await executeCommand(['git', '-C', fullPath, 'remote', 'get-url', 'origin'], { silent: true })
      const host = new URL(remoteUrl.trim()).hostname

      // Find matching credential
      const credential = getCredentialForHost(gitCredentials, host)
      if (!credential) {
        return createNoPromptGitEnv()
      }

      // Create env with specific credential
      const username = credential.username || getDefaultUsername(credential.host)
      const basicAuth = Buffer.from(`${username}:${credential.token}`, 'utf8').toString('base64')
      const normalizedHost = normalizeHost(credential.host)

      return {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${normalizedHost}.extraheader`,
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`
      }
    } catch {
      return createNoPromptGitEnv()
    }
  }
}