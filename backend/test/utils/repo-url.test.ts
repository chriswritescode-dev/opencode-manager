import { describe, it, expect } from 'vitest'
import {
  isScpStyleUrl,
  isSSHUrl,
  normalizeSSHUrl,
  extractHostFromSSHUrl,
  getRepoNameFromUrl,
  normalizeRepoUrlForCompare,
} from '@opencode-manager/shared/utils'

describe('isScpStyleUrl', () => {
  it('matches git@host:path', () => {
    expect(isScpStyleUrl('git@github.com:user/repo.git')).toBe(true)
  })

  it('matches custom-user host:path', () => {
    expect(isScpStyleUrl('company@company.ghe.com:orga/repo.git')).toBe(true)
  })

  it('does not match https URLs', () => {
    expect(isScpStyleUrl('https://github.com/user/repo.git')).toBe(false)
  })

  it('does not match shorthand owner/repo', () => {
    expect(isScpStyleUrl('user/repo')).toBe(false)
  })

  it('does not match ssh:// URLs', () => {
    expect(isScpStyleUrl('ssh://git@host/repo.git')).toBe(false)
  })
})

describe('isSSHUrl', () => {
  it('detects ssh:// URLs', () => {
    expect(isSSHUrl('ssh://git@github.com/user/repo.git')).toBe(true)
  })

  it('detects git@host:path scp-style URLs', () => {
    expect(isSSHUrl('git@github.com:user/repo.git')).toBe(true)
  })

  it('detects custom-user scp-style URLs', () => {
    expect(isSSHUrl('company@company.ghe.com:orga/repo.git')).toBe(true)
    expect(isSSHUrl('deploy@git.example.com:apps/repo')).toBe(true)
  })

  it('does not detect https, credentialed https, or shorthand URLs', () => {
    expect(isSSHUrl('https://github.com/user/repo.git')).toBe(false)
    expect(isSSHUrl('https://oauth2:TOKEN@gitlab.com/user/repo.git')).toBe(false)
    expect(isSSHUrl('user/repo')).toBe(false)
  })
})

describe('normalizeSSHUrl', () => {
  it('returns ssh:// URLs unchanged', () => {
    expect(normalizeSSHUrl('ssh://git@github.com:2222/user/repo.git')).toBe('ssh://git@github.com:2222/user/repo.git')
  })

  it('converts git@host:port/path to ssh:// form', () => {
    expect(normalizeSSHUrl('git@github.com:2222/user/repo.git')).toBe('ssh://git@github.com:2222/user/repo.git')
  })

  it('converts custom-user host:port/path to ssh:// form', () => {
    expect(normalizeSSHUrl('company@company.ghe.com:2222/orga/repo.git')).toBe('ssh://company@company.ghe.com:2222/orga/repo.git')
  })

  it('leaves scp-style URLs without a port unchanged', () => {
    expect(normalizeSSHUrl('company@company.ghe.com:orga/repo.git')).toBe('company@company.ghe.com:orga/repo.git')
  })

  it('leaves out-of-range ports unchanged', () => {
    expect(normalizeSSHUrl('git@github.com:99999/user/repo.git')).toBe('git@github.com:99999/user/repo.git')
  })

  it('reads digits as an owner when no repo path follows, matching git semantics', () => {
    expect(normalizeSSHUrl('git@github.com:2222/repo.git')).toBe('git@github.com:2222/repo.git')
  })

  it('reads digits as a port when a full owner/repo path follows', () => {
    expect(normalizeSSHUrl('git@git.example.com:2222/owner/repo.git')).toBe('ssh://git@git.example.com:2222/owner/repo.git')
  })

  it('treats a custom port before nested groups as a port', () => {
    expect(normalizeSSHUrl('git@git.example.com:2222/group/subgroup/project.git')).toBe('ssh://git@git.example.com:2222/group/subgroup/project.git')
  })
})

describe('extractHostFromSSHUrl', () => {
  it('extracts host from git@host:path', () => {
    expect(extractHostFromSSHUrl('git@github.com:user/repo.git')).toBe('github.com')
  })

  it('extracts host from custom-user scp-style URL', () => {
    expect(extractHostFromSSHUrl('company@company.ghe.com:orga/repo.git')).toBe('company.ghe.com')
  })

  it('extracts host with port from ssh:// URL', () => {
    expect(extractHostFromSSHUrl('ssh://git@git.example.com:2222/user/repo.git')).toBe('git.example.com:2222')
  })

  it('returns null for non-SSH URLs', () => {
    expect(extractHostFromSSHUrl('https://github.com/user/repo.git')).toBeNull()
  })

  it('fails closed when the host segment contains a path separator', () => {
    expect(extractHostFromSSHUrl('git@github.com/owner:repo')).toBeNull()
  })
})

describe('getRepoNameFromUrl', () => {
  it('extracts repo name from custom-user scp URL', () => {
    expect(getRepoNameFromUrl('company@company.ghe.com:orga/repo.git')).toBe('repo')
    expect(getRepoNameFromUrl('company@company.ghe.com:repo.git')).toBe('repo')
  })

  it('extracts repo name from git@ scp URL', () => {
    expect(getRepoNameFromUrl('git@github.com:user/repo.git')).toBe('repo')
  })

  it('extracts repo name from https URL', () => {
    expect(getRepoNameFromUrl('https://github.com/user/repo.git')).toBe('repo')
  })
})

describe('normalizeRepoUrlForCompare', () => {
  it('normalizes custom-user scp URL to https host/path', () => {
    expect(normalizeRepoUrlForCompare('company@company.ghe.com:orga/repo.git')).toBe('https://company.ghe.com/orga/repo')
  })

  it('normalizes git@ scp URL to https github path', () => {
    expect(normalizeRepoUrlForCompare('git@github.com:user/repo.git')).toBe('https://github.com/user/repo')
  })

  it('normalizes shorthand owner/repo to github URL', () => {
    expect(normalizeRepoUrlForCompare('user/repo')).toBe('https://github.com/user/repo')
  })

  it('normalizes ssh:// URL to https host/path', () => {
    expect(normalizeRepoUrlForCompare('ssh://git@gitlab.com/user/repo.git')).toBe('https://gitlab.com/user/repo')
  })

  it('normalizes https URL case-insensitively', () => {
    expect(normalizeRepoUrlForCompare('HTTPS://GitHub.com/User/Repo.git')).toBe('https://github.com/user/repo')
  })

  it('gives scp-with-port and ssh:// spellings of the same remote one identity', () => {
    const scpWithPort = normalizeRepoUrlForCompare('git@git.example.com:3000/owner/repo.git')
    const explicitSSH = normalizeRepoUrlForCompare('ssh://git@git.example.com:3000/owner/repo.git')

    expect(scpWithPort).toBe('https://git.example.com:3000/owner/repo')
    expect(scpWithPort).toBe(explicitSSH)
  })

  it('keeps a digit-named owner in the path instead of reading it as a port', () => {
    expect(normalizeRepoUrlForCompare('git@github.com:2222/repo.git')).toBe('https://github.com/2222/repo')
  })

  it('keeps distinct SSH ports distinct', () => {
    expect(normalizeRepoUrlForCompare('ssh://git@git.example.com:3000/owner/repo.git'))
      .not.toBe(normalizeRepoUrlForCompare('ssh://git@git.example.com:2222/owner/repo.git'))
  })

  it('strips embedded credentials so tokenized and clean https URLs match', () => {
    const clean = normalizeRepoUrlForCompare('https://gitlab.com/owner/repo.git')

    expect(normalizeRepoUrlForCompare('https://oauth2:TOKEN@gitlab.com/owner/repo.git')).toBe(clean)
    expect(normalizeRepoUrlForCompare('https://x-access-token:TOKEN@gitlab.com/owner/repo.git')).toBe(clean)
    expect(normalizeRepoUrlForCompare('https://user@gitlab.com/owner/repo.git')).toBe(clean)
    expect(clean).toBe('https://gitlab.com/owner/repo')
  })

  it('does not leak a token into the comparison key', () => {
    expect(normalizeRepoUrlForCompare('https://oauth2:SECRETTOKEN@gitlab.com/owner/repo.git')).not.toContain('secrettoken')
  })

  it('upgrades http to https so both spellings match', () => {
    expect(normalizeRepoUrlForCompare('http://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
  })

  it('preserves non-default https ports', () => {
    expect(normalizeRepoUrlForCompare('https://git.example.com:8443/owner/repo.git')).toBe('https://git.example.com:8443/owner/repo')
  })

  it('leaves local paths and file URLs alone', () => {
    expect(normalizeRepoUrlForCompare('/Users/me/repo')).toBe('/users/me/repo')
    expect(normalizeRepoUrlForCompare('file:///Users/me/repo')).toBe('file:///users/me/repo')
  })
})
