import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitCredential } from '@opencode-manager/shared'
import { expectLoggedMessage } from '../helpers/log-assertions'
import {
  createGhCliEnv,
  createGitEnv,
  createGitIdentityEnv,
  fetchGitHubUserInfo,
  findGitHubCredential,
  findPatCredentialForHost,
  getDefaultUsername,
  getSSHCredentialsForHost,
  normalizeHost,
  resolveGitIdentity,
} from '../../src/utils/git-auth'

const fetchSpy = vi.spyOn(globalThis, 'fetch')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function respondWithUser(user: { id?: number | null; login?: string | null; name?: string | null }): void {
  fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
}

function respondWithEmails(emails: Array<{ email: string; primary: boolean; verified: boolean }>): void {
  fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(emails), { status: 200 }))
}

function respondWithStatus(status: number): void {
  fetchSpy.mockResolvedValueOnce(new Response(null, { status }))
}

const GITHUB_CREDENTIAL: GitCredential = { name: 'github', host: 'https://github.com/', type: 'pat', token: 'gh-token' }

beforeEach(() => {
  fetchSpy.mockReset()
})

afterAll(() => {
  fetchSpy.mockRestore()
})

describe('fetchGitHubUserInfo', () => {
  it('uses the verified primary email when available', async () => {
    respondWithUser({ login: 'testuser', name: 'Test User', id: 123456 })
    respondWithEmails([{ email: 'verified@email.com', primary: true, verified: true }])

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toEqual({ login: 'testuser', name: 'Test User', email: 'verified@email.com' })
  })

  it.each([
    ['the emails endpoint fails', 1],
    ['the emails list is empty', 0],
    ['no email is verified', 0],
  ])('falls back to the noreply email when %s', async (scenario) => {
    respondWithUser({ login: 'testuser', name: 'Test User', id: 123456 })
    if (scenario === 'the emails endpoint fails') {
      respondWithStatus(500)
    } else {
      respondWithEmails(
        scenario === 'no email is verified'
          ? [{ email: 'unverified@email.com', primary: false, verified: false }]
          : [],
      )
    }

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.email).toBe('123456+testuser@users.noreply.github.com')
  })

  it('returns null when the user endpoint fails', async () => {
    respondWithStatus(401)
    respondWithStatus(500)

    const result = await fetchGitHubUserInfo('invalid_token')

    expect(result).toBeNull()
  })

  it.each([
    ['id', { login: 'testuser', name: 'Test User', id: null }],
    ['login', { login: null, name: 'Test User', id: 123456 }],
  ])('returns null when the user payload has no %s', async (_field, user) => {
    respondWithUser(user)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toBeNull()
  })

  it('keeps a null name and reports the login', async () => {
    respondWithUser({ login: 'testuser', name: null, id: 123456 })
    respondWithStatus(500)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toEqual({
      login: 'testuser',
      name: null,
      email: '123456+testuser@users.noreply.github.com',
    })
  })

  it('returns null and logs a warning when the network fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'))
    fetchSpy.mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toBeNull()
    expectLoggedMessage('Failed to fetch GitHub user info', 'warn')
  })

  it('requests the user and emails endpoints in parallel with the token', async () => {
    const user = deferred<Response>()
    const emails = deferred<Response>()
    fetchSpy.mockReturnValueOnce(user.promise).mockReturnValueOnce(emails.promise)

    const pending = fetchGitHubUserInfo('test_token')
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/emails',
    ])
    for (const [, init] of fetchSpy.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test_token')
    }

    user.resolve(new Response(JSON.stringify({ login: 'testuser', name: 'Test User', id: 1 })))
    emails.resolve(new Response(JSON.stringify([])))
    await expect(pending).resolves.toEqual({
      login: 'testuser',
      name: 'Test User',
      email: '1+testuser@users.noreply.github.com',
    })
  })
})

describe('createGitEnv', () => {
  it('creates URL-scoped extraheader keys that git can match against HTTPS remotes', () => {
    const env = createGitEnv([{ name: 'github', host: 'github.com', type: 'pat', token: 'github-token' }])

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
    expect(env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${Buffer.from('x-access-token:github-token', 'utf8').toString('base64')}`)
  })

  it('normalizes hosts with protocols, paths, and trailing slashes', () => {
    const env = createGitEnv([
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'github-token' },
      { name: 'gitlab', host: 'https://gitlab.com/group/project.git', type: 'pat', token: 'gitlab-token' },
    ])

    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
    expect(env.GIT_CONFIG_KEY_1).toBe('http.https://gitlab.com/.extraheader')
  })

  it('skips credentials whose host cannot be parsed', () => {
    const env = createGitEnv([
      { name: 'broken', host: '   ', type: 'pat', token: 'broken-token' },
      { name: 'github', host: 'github.com', type: 'pat', token: 'github-token' },
    ])

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
  })

  it('emits a single extraheader per host so git cannot send competing Authorization headers', () => {
    const env = createGitEnv([
      { name: 'first', host: 'github.com', type: 'pat', token: 'first-token' },
      { name: 'second', host: 'https://github.com/', type: 'pat', token: 'second-token' },
    ])

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `AUTHORIZATION: basic ${Buffer.from('x-access-token:first-token', 'utf8').toString('base64')}`
    )
    expect(env.GIT_CONFIG_KEY_1).toBeUndefined()
  })

  it('lets the preferred credential win its host over other credentials for that host', () => {
    const env = createGitEnv(
      [
        { name: 'first', host: 'github.com', type: 'pat', token: 'first-token' },
        { name: 'gitlab', host: 'gitlab.com', type: 'pat', token: 'gitlab-token' },
      ],
      { name: 'repo-bound', host: 'github.com', type: 'pat', token: 'repo-bound-token' }
    )

    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `AUTHORIZATION: basic ${Buffer.from('x-access-token:repo-bound-token', 'utf8').toString('base64')}`
    )
    expect(env.GIT_CONFIG_KEY_1).toBe('http.https://gitlab.com/.extraheader')
  })
})

describe('createGhCliEnv', () => {
  it('returns GH_TOKEN and GITHUB_TOKEN set to the token for a github PAT', () => {
    const env = createGhCliEnv([{ name: 'github', host: 'https://github.com/', type: 'pat', token: 'gh-cli-token' }])

    expect(env).toEqual({ GH_TOKEN: 'gh-cli-token', GITHUB_TOKEN: 'gh-cli-token' })
  })

  const emptyCases: Array<[string, GitCredential[]]> = [
    ['no github credential', [{ name: 'gitlab', host: 'https://gitlab.com/', type: 'pat', token: 'gl-token' }]],
    ['an empty token', [{ name: 'github', host: 'https://github.com/', type: 'pat', token: '' }]],
    ['only an ssh github credential', [{ name: 'github-ssh', host: 'git@github.com', type: 'ssh', sshPrivateKey: 'key' }]],
  ]

  it.each(emptyCases)('returns {} for %s', (_scenario, credentials) => {
    expect(createGhCliEnv(credentials)).toEqual({})
  })
})

describe('normalizeHost', () => {
  it('returns a URL-form host prefix for git url matching', () => {
    expect(normalizeHost('github.com')).toBe('https://github.com/')
    expect(normalizeHost('https://github.com/owner/repo.git')).toBe('https://github.com/')
  })

  it('returns null when the host cannot be parsed', () => {
    expect(normalizeHost('   ')).toBeNull()
  })
})

describe('getDefaultUsername', () => {
  it('uses the GitHub token username for bare and URL hosts', () => {
    expect(getDefaultUsername('github.com')).toBe('x-access-token')
    expect(getDefaultUsername('https://github.com/')).toBe('x-access-token')
  })

  it('falls back to oauth2 for non-github hosts', () => {
    expect(getDefaultUsername('gitlab.com')).toBe('oauth2')
    expect(getDefaultUsername('https://git.example.com/')).toBe('oauth2')
  })
})

describe('findGitHubCredential', () => {
  it('finds the GitHub PAT among other credentials', () => {
    const credentials: GitCredential[] = [
      { name: 'gitlab', host: 'https://gitlab.com/', type: 'pat', token: 'gitlab-token' },
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'github-token' },
      { name: 'private', host: 'https://git.example.com/', type: 'pat', token: 'private-token' },
    ]

    expect(findGitHubCredential(credentials)).toEqual(credentials[1])
  })

  it('does not match a www subdomain', () => {
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://www.github.com/', type: 'pat', token: 'github-token' },
    ]

    expect(findGitHubCredential(credentials)).toBeNull()
  })

  const emptyCases: Array<[string, GitCredential[]]> = [
    ['the list is empty', []],
    ['no credential points at GitHub', [{ name: 'gitlab', host: 'https://gitlab.com/', type: 'pat', token: 'gl-token' }]],
  ]

  it.each(emptyCases)('returns null when %s', (_scenario, credentials) => {
    expect(findGitHubCredential(credentials)).toBeNull()
  })

  it('finds a credential whose host has no protocol', () => {
    const credentials: GitCredential[] = [{ name: 'github', host: 'github.com', type: 'pat', token: 'github-token' }]

    expect(findGitHubCredential(credentials)).toEqual(credentials[0])
  })

  it('ignores SSH credentials when looking up a GitHub PAT', () => {
    const credentials: GitCredential[] = [
      { name: 'github-ssh', host: 'git@github.com', type: 'ssh', token: 'ssh-key' },
      { name: 'github-pat', host: 'https://github.com/', type: 'pat', token: 'pat-token' },
    ]

    expect(findGitHubCredential(credentials)).toEqual(credentials[1])
  })
})

describe('findPatCredentialForHost', () => {
  it('matches by hostname when stored as full https URL', () => {
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/owner/repo.git', type: 'pat', token: 'gh-token' },
    ]

    expect(findPatCredentialForHost(credentials, 'github.com')).toEqual({ username: 'x-access-token', password: 'gh-token' })
  })

  it('uses the explicit username when provided', () => {
    const credentials: GitCredential[] = [
      { name: 'github', host: 'github.com', type: 'pat', token: 'gh-token', username: 'custom-user' },
    ]

    expect(findPatCredentialForHost(credentials, 'github.com')).toEqual({ username: 'custom-user', password: 'gh-token' })
  })

  it.each([
    ['github.com', 'x-access-token'],
    ['gitlab.com', 'oauth2'],
  ])('derives the default username for %s', (host, username) => {
    const credentials: GitCredential[] = [{ name: 'host', host, type: 'pat', token: 'token' }]

    expect(findPatCredentialForHost(credentials, host)?.username).toBe(username)
  })

  it('ignores ssh credentials', () => {
    const credentials: GitCredential[] = [
      { name: 'github-ssh', host: 'github.com', type: 'ssh', sshPrivateKey: 'key' },
      { name: 'github-pat', host: 'github.com', type: 'pat', token: 'pat-token' },
    ]

    expect(findPatCredentialForHost(credentials, 'github.com')).toEqual({ username: 'x-access-token', password: 'pat-token' })
  })

  it('returns null when no credential matches the host', () => {
    const credentials: GitCredential[] = [{ name: 'gitlab', host: 'gitlab.com', type: 'pat', token: 'gl-token' }]

    expect(findPatCredentialForHost(credentials, 'github.com')).toBeNull()
  })

  it('returns an empty password when the matched credential has no token', () => {
    const credentials: GitCredential[] = [{ name: 'github', host: 'github.com', type: 'pat' }]

    expect(findPatCredentialForHost(credentials, 'github.com')).toEqual({ username: 'x-access-token', password: '' })
  })
})

describe('resolveGitIdentity', () => {
  it('returns the manual identity without contacting GitHub when both fields are set', async () => {
    const result = await resolveGitIdentity({ name: 'John Doe', email: 'john@example.com' }, [])

    expect(result).toEqual({ name: 'John Doe', email: 'john@example.com' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the manual name and takes the GitHub email', async () => {
    respondWithUser({ login: 'testuser', name: 'GitHub User', id: 123456 })
    respondWithEmails([{ email: 'gh@example.com', primary: true, verified: true }])

    const result = await resolveGitIdentity({ name: 'Custom Name', email: undefined }, [GITHUB_CREDENTIAL])

    expect(result).toEqual({ name: 'Custom Name', email: 'gh@example.com' })
  })

  it('uses the GitHub identity when no manual identity is set', async () => {
    respondWithUser({ login: 'testuser', name: 'Test User', id: 123456 })
    respondWithEmails([{ email: 'test@example.com', primary: true, verified: true }])

    const result = await resolveGitIdentity(undefined, [GITHUB_CREDENTIAL])

    expect(result).toEqual({ name: 'Test User', email: 'test@example.com' })
  })

  it('falls back to the GitHub login when the name is missing', async () => {
    respondWithUser({ login: 'testuser', name: null, id: 123456 })
    respondWithEmails([{ email: 'test@example.com', primary: true, verified: true }])

    const result = await resolveGitIdentity(undefined, [GITHUB_CREDENTIAL])

    expect(result).toEqual({ name: 'testuser', email: 'test@example.com' })
  })

  it('returns the manual name with an empty email when GitHub fails', async () => {
    respondWithStatus(401)
    respondWithStatus(500)

    const result = await resolveGitIdentity({ name: 'Only Name', email: undefined }, [
      { ...GITHUB_CREDENTIAL, token: 'invalid-token' },
    ])

    expect(result).toEqual({ name: 'Only Name', email: '' })
  })

  it('returns null when no identity source is available', async () => {
    const result = await resolveGitIdentity(undefined, [])

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when both manual fields are empty and GitHub fails', async () => {
    respondWithStatus(401)
    respondWithStatus(500)

    const result = await resolveGitIdentity({ name: undefined, email: undefined }, [GITHUB_CREDENTIAL])

    expect(result).toBeNull()
  })
})

describe('createGitIdentityEnv', () => {
  it('maps the identity onto the author and committer variables', () => {
    expect(createGitIdentityEnv({ name: 'John Doe', email: 'john@example.com' })).toEqual({
      GIT_AUTHOR_NAME: 'John Doe',
      GIT_AUTHOR_EMAIL: 'john@example.com',
      GIT_COMMITTER_NAME: 'John Doe',
      GIT_COMMITTER_EMAIL: 'john@example.com',
    })
  })

  it('passes empty strings through', () => {
    expect(createGitIdentityEnv({ name: '', email: 'email@example.com' })).toEqual({
      GIT_AUTHOR_NAME: '',
      GIT_AUTHOR_EMAIL: 'email@example.com',
      GIT_COMMITTER_NAME: '',
      GIT_COMMITTER_EMAIL: 'email@example.com',
    })
  })
})

describe('getSSHCredentialsForHost', () => {
  const sshCredential = (host: string, name = 'test'): GitCredential => ({
    name,
    host,
    type: 'ssh',
    sshPrivateKey: 'key',
  })

  it.each([
    ['github.com', 'github.com', 1],
    ['git@bitbucket.org', 'bitbucket.org', 1],
    ['git@github.com', 'github.com', 1],
    ['deploy@example.com', 'example.com', 1],
    ['ssh://git@github.com:22', 'github.com', 1],
    ['ssh://git@github.com:22', 'github.com:22', 1],
    ['https://git@github.com', 'github.com', 1],
    ['git@github.com:22', 'github.com', 1],
    ['git@github.com:22', 'github.com:22', 1],
    ['git@gitlab.com', 'github.com', 0],
    ['git@github.com:2222', 'github.com:22', 0],
  ])('matches credential host %s against %s', (credentialHost, targetHost, expected) => {
    expect(getSSHCredentialsForHost([sshCredential(credentialHost)], targetHost)).toHaveLength(expected)
  })

  it('filters out non-ssh credentials', () => {
    const patCredential: GitCredential = { ...sshCredential('github.com'), type: 'pat' }

    expect(getSSHCredentialsForHost([patCredential], 'github.com')).toHaveLength(0)
  })
})
