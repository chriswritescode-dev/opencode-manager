import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGitHubUserInfo, findGitHubCredential, resolveGitIdentity, createGitIdentityEnv } from '../../src/utils/git-auth'
import type { GitCredential } from '../../src/utils/git-auth'

describe('fetchGitHubUserInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use verified primary email when available', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'verified@email.com', primary: true, verified: true }
      ])
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.email).toBe('verified@email.com')
    expect(result?.name).toBe('Test User')
    expect(result?.login).toBe('testuser')
  })

  it('should fallback to noreply email when no verified primary email', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = { ok: false }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.email).toBe('123456+testuser@users.noreply.github.com')
  })

  it('should fallback to noreply email when emails API returns empty array', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([])
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.email).toBe('123456+testuser@users.noreply.github.com')
  })

  it('should fallback to noreply email when no verified email in list', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'unverified@email.com', primary: false, verified: false }
      ])
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.email).toBe('123456+testuser@users.noreply.github.com')
  })

  it('should return null when user API fails', async () => {
    const userResponse = { ok: false }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)

    const result = await fetchGitHubUserInfo('invalid_token')

    expect(result).toBeNull()
  })

  it('should return null when user data is missing id', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: null
      })
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toBeNull()
  })

  it('should return null when user data is missing login', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: null,
        name: 'Test User',
        id: 123456
      })
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toBeNull()
  })

  it('should use login as name when name is null', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: null,
        id: 123456
      })
    }
    const emailsResponse = { ok: false }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await fetchGitHubUserInfo('test_token')

    expect(result?.name).toBeNull()
    expect(result?.login).toBe('testuser')
  })

  it('should handle network errors gracefully', async () => {
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockRejectedValue(new Error('Network error'))

    const result = await fetchGitHubUserInfo('test_token')

    expect(result).toBeNull()
  })

  it('should make parallel API calls to user and endpoints', async () => {
    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'verified@email.com', primary: true, verified: true }
      ])
    }
    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    await fetchGitHubUserInfo('test_token')

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/user',
      expect.any(Object)
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user/emails',
      expect.any(Object)
    )
  })
})

describe('findGitHubCredential', () => {
  it('should find GitHub credential in credentials array', () => {
    const credentials: GitCredential[] = [
      { name: 'gitlab', host: 'https://gitlab.com/', type: 'pat', token: 'gitlab-token' },
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'github-token' },
      { name: 'private', host: 'https://git.example.com/', type: 'pat', token: 'private-token' },
    ]

    const result = findGitHubCredential(credentials)

    expect(result).toEqual({
      name: 'github',
      host: 'https://github.com/',
      type: 'pat',
      token: 'github-token'
    })
  })

  it('should not find GitHub credential with www subdomain', () => {
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://www.github.com/', type: 'pat', token: 'github-token' },
    ]

    const result = findGitHubCredential(credentials)

    expect(result).toBeNull()
  })

  it('should return null when credentials array is empty', () => {
    const result = findGitHubCredential([])

    expect(result).toBeNull()
  })

  it('should return null when no GitHub credential exists', () => {
    const credentials: GitCredential[] = [
      { name: 'gitlab', host: 'https://gitlab.com/', type: 'pat', token: 'gitlab-token' },
      { name: 'private', host: 'https://git.example.com/', type: 'pat', token: 'private-token' },
    ]

    const result = findGitHubCredential(credentials)

    expect(result).toBeNull()
  })
})

describe('resolveGitIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn() as any;
  })

  it('should return manual identity when both name and email provided', async () => {
    const manual = { name: 'John Doe', email: 'john@example.com' }
    const credentials: GitCredential[] = []

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toEqual({
      name: 'John Doe',
      email: 'john@example.com'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('should prioritize manual name but use GitHub email', async () => {
    const manual = { name: 'Custom Name', email: undefined }
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'gh-token' },
    ]

    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'GitHub User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'gh@example.com', primary: true, verified: true }
      ])
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toEqual({
      name: 'Custom Name',
      email: 'gh@example.com'
    })
  })

  it('should use GitHub identity when no manual identity', async () => {
    const manual = undefined
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'gh-token' },
    ]

    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: 'Test User',
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'test@example.com', primary: true, verified: true }
      ])
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toEqual({
      name: 'Test User',
      email: 'test@example.com'
    })
  })

  it('should use login as name when GitHub name is null', async () => {
    const manual = undefined
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'gh-token' },
    ]

    const userResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        login: 'testuser',
        name: null,
        id: 123456
      })
    }
    const emailsResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([
        { email: 'test@example.com', primary: true, verified: true }
      ])
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce(userResponse)
      .mockResolvedValueOnce(emailsResponse)

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toEqual({
      name: 'testuser',
      email: 'test@example.com'
    })
  })

  it('should return partial identity when GitHub fails but manual has one field', async () => {
    const manual = { name: 'Only Name', email: undefined }
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'invalid-token' },
    ]

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce({ ok: false })

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toEqual({
      name: 'Only Name',
      email: ''
    })
  })

  it('should return null when no identity available', async () => {
    const manual = undefined
    const credentials: GitCredential[] = []

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('should return null when both manual fields are empty and GitHub fails', async () => {
    const manual = { name: undefined, email: undefined }
    const credentials: GitCredential[] = [
      { name: 'github', host: 'https://github.com/', type: 'pat', token: 'invalid-token' },
    ]

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValueOnce({ ok: false })

    const result = await resolveGitIdentity(manual, credentials)

    expect(result).toBeNull()
  })
})

describe('createGitIdentityEnv', () => {
  it('should create git identity environment variables', () => {
    const identity = { name: 'John Doe', email: 'john@example.com' }

    const result = createGitIdentityEnv(identity)

    expect(result).toEqual({
      GIT_AUTHOR_NAME: 'John Doe',
      GIT_AUTHOR_EMAIL: 'john@example.com',
      GIT_COMMITTER_NAME: 'John Doe',
      GIT_COMMITTER_EMAIL: 'john@example.com'
    })
  })

  it('should handle empty strings in identity', () => {
    const identity = { name: '', email: 'email@example.com' }

    const result = createGitIdentityEnv(identity)

    expect(result).toEqual({
      GIT_AUTHOR_NAME: '',
      GIT_AUTHOR_EMAIL: 'email@example.com',
      GIT_COMMITTER_NAME: '',
      GIT_COMMITTER_EMAIL: 'email@example.com'
    })
  })
})