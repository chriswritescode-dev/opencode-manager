import type { GitCredential } from '@opencode-manager/shared'

export function isGitHubHttpsUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
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

export function isSSHUrl(url: string): boolean {
  return url.startsWith('git@') || url.startsWith('ssh://')
}

export function normalizeSSHUrl(url: string): string {
  if (url.startsWith('ssh://')) {
    return url
  }

  const match = url.match(/^git@([^:]+):(\d{1,5})\/(.+)$/)
  if (match) {
    const [, host, port, path] = match
    const portNum = parseInt(port!, 10)
    if (portNum > 0 && portNum <= 65535) {
      return `ssh://git@${host}:${port}/${path}`
    }
  }
  return url
}

export function extractHostFromSSHUrl(url: string): string | null {
  if (url.startsWith('git@')) {
    const match = url.match(/^git@([^:]+):/)
    const host = match?.[1]
    return host || null
  }
  if (url.startsWith('ssh://')) {
    try {
      const parsed = new URL(url)
      const hostname = parsed.hostname ?? ''
      const port = parsed.port ?? ''
      return port ? `${hostname}:${port}` : parsed.hostname || null
    } catch {
      return null
    }
  }
  return null
}

export function normalizeHost(host: string): string {
  if (!host.endsWith('/')) {
    return `${host}/`
  }
  return host
}

export function createGitEnv(credentials: GitCredential[]): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
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
  return createGitEnv([{ name: 'GitHub', host: 'https://github.com/', token: gitToken, type: 'pat' }])
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

export function getSSHCredentialsForHost(credentials: GitCredential[], host: string): GitCredential[] {
  return credentials.filter(cred => {
    if (cred.type !== 'ssh') return false
    
    const credHost = cred.host.toLowerCase()
    const targetHost = host.toLowerCase()
    
    if (credHost === targetHost) {
      return true
    }
    
    try {
      const parsedCredHost = new URL(credHost)
      const credHostname = parsedCredHost.hostname.toLowerCase()
      const credPort = parsedCredHost.port || (parsedCredHost.protocol.includes('ssh') ? 22 : null)
      const normalizedCredHost = credPort ? `${credHostname}:${credPort}` : credHostname
      
      const parsedTargetHost = new URL(`ssh://dummy@${targetHost}`)
      const targetHostname = parsedTargetHost.hostname.toLowerCase()
      const targetPort = parsedTargetHost.port || 22
      const normalizedTargetHost = targetPort !== '' ? `${targetHostname}:${targetPort}` : targetHostname
      
      return normalizedCredHost === normalizedTargetHost
    } catch {
      if (credHost.includes(':')) {
        const [credHostname, credPort] = credHost.split(':')
        if (targetHost.includes(':')) {
          const [targetHostname, targetPort] = targetHost.split(':')
          return credHostname === targetHostname && credPort === targetPort
        }
        return credHostname === targetHost
      }
      return credHost === targetHost
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
  if (githubCred && githubCred.token) {
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
