

export interface GitCredential {
  name: string
  host: string
  token: string
  username?: string
}

import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function isGitHubHttpsUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

export function createNoPromptGitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: ''
  }
}

export function getDefaultUsername(host: string): string {
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

export function normalizeHost(host: string): string {
  if (!host.endsWith('/')) {
    return `${host}/`
  }
  return host
}

export function createGitEnv(credentials: GitCredential[]): Record<string, string> {
  const askpassPath = path.join(__dirname, 'git-askpass.ts')
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: `bun run ${askpassPath}`,
    SSH_ASKPASS: `bun run ${askpassPath}`,
    GIT_CONFIG_COUNT: '0'
  }
  
  if (!credentials || credentials.length === 0) {
    return env
  }

  let configIndex = 0

  for (const cred of credentials) {
    if (!cred.host || !cred.token) {
      continue
    }

    const host = normalizeHost(cred.host)
    const username = cred.username || getDefaultUsername(host)
    const basicAuth = Buffer.from(`${username}:${cred.token}`, 'utf8').toString('base64')

    env[`GIT_CONFIG_KEY_${configIndex}`] = `http.${host}.extraheader`
    env[`GIT_CONFIG_VALUE_${configIndex}`] = `AUTHORIZATION: basic ${basicAuth}`
    configIndex++
  }

  env.GIT_CONFIG_COUNT = String(configIndex)

  return env
}

export function createGitHubGitEnv(gitToken: string): Record<string, string> {
  return createGitEnv([{ name: 'GitHub', host: 'https://github.com/', token: gitToken }])
}

export function findGitHubCredential(credentials: GitCredential[]): GitCredential | null {
  if (!credentials || credentials.length === 0) return null
  
  return credentials.find(cred => {
    try {
      const parsed = new URL(cred.host)
      return parsed.hostname.toLowerCase() === 'github.com'
    } catch {
      return false
    }
  }) || null
}

export function getCredentialForHost(credentials: GitCredential[], host: string): GitCredential | undefined {
  return credentials.find(cred => {
    try {
      const parsed = new URL(cred.host)
      return parsed.hostname.toLowerCase() === host.toLowerCase()
    } catch {
      return false
    }
  })
}



export interface GitHubUserInfo {
  name: string | null
  email: string
  login: string
}


export interface GitIdentity {
  name: string
  email: string
}

export async function resolveGitIdentity(
  manualIdentity: { name?: string; email?: string } | undefined,
  credentials: GitCredential[]
): Promise<GitIdentity | null> {
  if (manualIdentity?.name && manualIdentity?.email) {
    return { name: manualIdentity.name, email: manualIdentity.email }
  }

  const githubCred = findGitHubCredential(credentials)
  if (githubCred) {
    const githubUser = await fetchGitHubUserInfo(githubCred.token)
    if (githubUser) {
      return {
        name: manualIdentity?.name || githubUser.name || githubUser.login,
        email: manualIdentity?.email || githubUser.email
      }
    }
  }

  if (manualIdentity?.name || manualIdentity?.email) {
    return {
      name: manualIdentity.name || '',
      email: manualIdentity.email || ''
    }
  }

  return null
}

export function createGitIdentityEnv(identity: GitIdentity): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email
  }
}

export async function fetchGitHubUserInfo(token: string): Promise<GitHubUserInfo | null> {
  try {
    const [userResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }),
      fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
    ])

    if (!userResponse.ok) return null

    const data = await userResponse.json() as { login: string; name: string | null; id: number }

    if (!data.id || !data.login) return null

    let email = `${data.id}+${data.login}@users.noreply.github.com`

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      const primaryEmail = emails.find(e => e.primary && e.verified)
      if (primaryEmail?.email) {
        email = primaryEmail.email
      }
    }

    return {
      name: data.name,
      email,
      login: data.login
    }
  } catch {
    return null
  }
}

import { SettingsService } from '../services/settings'
import type { Database } from 'bun:sqlite'
import { executeCommand } from '../utils/process'
import { getRepoById } from '../db/queries'
import path from 'path'

export class GitAuthService {
  async getGitEnvironment(repoId: number, database: Database): Promise<Record<string, string>> {
    try {
      const settingsService = new SettingsService(database)
      const settings = settingsService.getSettings('default')
      const gitCredentials: GitCredential[] = settings.preferences.gitCredentials || []

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
