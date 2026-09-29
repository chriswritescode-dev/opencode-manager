import { describe, it, expect } from 'vitest'
import { getLocalLinkPath, resolvePathFromFile, isExternalLink } from './markdownLinks'

const FROM = 'opencode-manager/ocm-link-test/index.md'

describe('getLocalLinkPath', () => {
  it('returns relative and absolute paths without query, fragment, or trailing slash', () => {
    expect(getLocalLinkPath('recaps/daily-overview-2026-09-29.html')).toBe('recaps/daily-overview-2026-09-29.html')
    expect(getLocalLinkPath('./report.html#top')).toBe('./report.html')
    expect(getLocalLinkPath('/workspace/repos/app/report.html?x=1')).toBe('/workspace/repos/app/report.html')
    expect(getLocalLinkPath('sub/')).toBe('sub')
    expect(getLocalLinkPath('/')).toBe('/')
    expect(getLocalLinkPath('my%20report.html')).toBe('my report.html')
  })

  it('ignores anchors, protocol-relative URLs, scheme links, empty, and malformed encodings', () => {
    expect(getLocalLinkPath(undefined)).toBeNull()
    expect(getLocalLinkPath('')).toBeNull()
    expect(getLocalLinkPath('#section')).toBeNull()
    expect(getLocalLinkPath('//example.com/a')).toBeNull()
    expect(getLocalLinkPath('https://example.com')).toBeNull()
    expect(getLocalLinkPath('mailto:a@b.c')).toBeNull()
    expect(getLocalLinkPath('bad%zz.html')).toBeNull()
  })
})

describe('resolvePathFromFile', () => {
  it('resolves sibling, dot-relative, nested, parent, and folder links against the containing file', () => {
    expect(resolvePathFromFile(FROM, 'report.html')).toBe('opencode-manager/ocm-link-test/report.html')
    expect(resolvePathFromFile(FROM, './report.html')).toBe('opencode-manager/ocm-link-test/report.html')
    expect(resolvePathFromFile(FROM, 'sub/page.html')).toBe('opencode-manager/ocm-link-test/sub/page.html')
    expect(resolvePathFromFile(FROM, '../README.md')).toBe('opencode-manager/README.md')
    expect(resolvePathFromFile(FROM, '..')).toBe('opencode-manager')
    expect(resolvePathFromFile('repo/my docs/index.md', 'a.html')).toBe('repo/my docs/a.html')
  })

  it('keeps parent segments above the repos root for the files API to validate', () => {
    expect(resolvePathFromFile('opencode-manager/index.md', '../../notes.md')).toBe('../notes.md')
    expect(resolvePathFromFile('../.config/opencode/AGENTS.md', 'skills/x.md')).toBe('../.config/opencode/skills/x.md')
  })

  it('returns absolute paths unchanged', () => {
    expect(resolvePathFromFile(FROM, '/workspace/repos/app/report.html')).toBe('/workspace/repos/app/report.html')
  })
})

describe('isExternalLink', () => {
  it('detects http and https links only', () => {
    expect(isExternalLink('https://example.com')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('recaps/a.html')).toBe(false)
    expect(isExternalLink(undefined)).toBe(false)
  })
})
