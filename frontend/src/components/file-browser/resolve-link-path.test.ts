import { describe, it, expect } from 'vitest'
import { resolveLinkedFilePath } from './resolve-link-path'

const FROM = 'opencode-manager/ocm-link-test/index.md'

describe('resolveLinkedFilePath', () => {
  it('resolves sibling, dot-relative, nested, and parent links against the containing file', () => {
    expect(resolveLinkedFilePath(FROM, 'report.html')).toBe('opencode-manager/ocm-link-test/report.html')
    expect(resolveLinkedFilePath(FROM, './report.html')).toBe('opencode-manager/ocm-link-test/report.html')
    expect(resolveLinkedFilePath(FROM, 'sub/page.html')).toBe('opencode-manager/ocm-link-test/sub/page.html')
    expect(resolveLinkedFilePath(FROM, '../README.md')).toBe('opencode-manager/README.md')
  })

  it('resolves folder links without the trailing slash', () => {
    expect(resolveLinkedFilePath(FROM, 'sub/')).toBe('opencode-manager/ocm-link-test/sub')
    expect(resolveLinkedFilePath(FROM, '..')).toBe('opencode-manager')
  })

  it('keeps parent segments above the repos root for the files API to validate', () => {
    expect(resolveLinkedFilePath('opencode-manager/index.md', '../../notes.md')).toBe('../notes.md')
    expect(resolveLinkedFilePath('../.config/opencode/AGENTS.md', 'skills/x.md')).toBe('../.config/opencode/skills/x.md')
  })

  it('returns absolute paths unchanged apart from query, fragment, and trailing slash', () => {
    expect(resolveLinkedFilePath(FROM, '/workspace/repos/app/report.html#top')).toBe('/workspace/repos/app/report.html')
    expect(resolveLinkedFilePath(FROM, '/workspace/repos/app/')).toBe('/workspace/repos/app')
  })

  it('drops query and fragment and decodes encoded names', () => {
    expect(resolveLinkedFilePath(FROM, 'report.html#summary')).toBe('opencode-manager/ocm-link-test/report.html')
    expect(resolveLinkedFilePath(FROM, 'my%20report.html?x=1')).toBe('opencode-manager/ocm-link-test/my report.html')
    expect(resolveLinkedFilePath('repo/my docs/index.md', 'a.html')).toBe('repo/my docs/a.html')
  })

  it('ignores anchors, protocol-relative URLs, and scheme links', () => {
    expect(resolveLinkedFilePath(FROM, '#section')).toBeNull()
    expect(resolveLinkedFilePath(FROM, '//example.com/a')).toBeNull()
    expect(resolveLinkedFilePath(FROM, 'https://example.com')).toBeNull()
    expect(resolveLinkedFilePath(FROM, 'mailto:a@b.c')).toBeNull()
    expect(resolveLinkedFilePath(FROM, '')).toBeNull()
    expect(resolveLinkedFilePath(FROM, '/')).toBeNull()
  })

  it('returns null for malformed percent-encoding', () => {
    expect(resolveLinkedFilePath(FROM, 'bad%zz.html')).toBeNull()
  })
})
