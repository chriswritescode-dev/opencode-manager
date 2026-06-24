import { describe, it, expect } from 'vitest'
import {
  isHtmlPath,
  normalizeWorkspaceFilePath,
  createHtmlArtifact,
  getArtifactTitle,
  normalizeHtmlPreviewDocument,
} from './htmlArtifacts'

describe('isHtmlPath', () => {
  it('returns true for .html paths', () => {
    expect(isHtmlPath('repo/report.html')).toBe(true)
  })

  it('returns true for .HTM paths (case-insensitive)', () => {
    expect(isHtmlPath('page.HTM')).toBe(true)
    expect(isHtmlPath('page.Htm')).toBe(true)
  })

  it('returns false for .tsx paths', () => {
    expect(isHtmlPath('component.tsx')).toBe(false)
  })

  it('returns false for .md paths', () => {
    expect(isHtmlPath('readme.md')).toBe(false)
  })

  it('returns false for missing path', () => {
    expect(isHtmlPath(undefined)).toBe(false)
    expect(isHtmlPath('')).toBe(false)
  })

  it('ignores query strings and hash fragments', () => {
    expect(isHtmlPath('index.html?raw=true')).toBe(true)
    expect(isHtmlPath('index.html#section')).toBe(true)
    expect(isHtmlPath('page.htm?query=1#hash')).toBe(true)
  })
})

describe('normalizeWorkspaceFilePath', () => {
  it('strips workspace repos path prefix', () => {
    const result = normalizeWorkspaceFilePath(
      '/workspace/repos/my-repo/dist/index.html',
      '/workspace/repos/my-repo',
    )
    expect(result).toBe('my-repo/dist/index.html')
  })

  it('returns non-matching absolute paths unchanged', () => {
    const result = normalizeWorkspaceFilePath(
      '/some/other/path/file.html',
      '/workspace/repos/my-repo',
    )
    expect(result).toBe('/some/other/path/file.html')
  })

  it('returns relative paths unchanged', () => {
    const result = normalizeWorkspaceFilePath('relative/path.html', '/workspace/repos/my-repo')
    expect(result).toBe('relative/path.html')
  })

  it('returns path unchanged when repoFullPath is missing', () => {
    const result = normalizeWorkspaceFilePath('/workspace/repos/my-repo/file.html')
    expect(result).toBe('/workspace/repos/my-repo/file.html')
  })
})

describe('createHtmlArtifact', () => {
  it('creates an inline artifact with required html', () => {
    const artifact = createHtmlArtifact({ source: 'inline', html: '<h1>Hello</h1>' })
    expect(artifact.source).toBe('inline')
    expect(artifact.html).toBe('<h1>Hello</h1>')
    expect(artifact.id).toBeTruthy()
    expect(artifact.title).toBe('Untitled Artifact')
  })

  it('creates a file artifact with required path', () => {
    const artifact = createHtmlArtifact({ source: 'file', path: 'my-repo/dist/index.html' })
    expect(artifact.source).toBe('file')
    expect(artifact.path).toBe('my-repo/dist/index.html')
    expect(artifact.id).toBeTruthy()
    expect(artifact.title).toBe('index')
  })

  it('uses provided title', () => {
    const artifact = createHtmlArtifact({
      source: 'inline',
      html: '<h1>Hello</h1>',
      title: 'My Artifact',
    })
    expect(artifact.title).toBe('My Artifact')
  })

  it('throws when path is missing for file artifact', () => {
    expect(() => createHtmlArtifact({ source: 'file' })).toThrow('path is required')
  })

  it('throws when html is missing for inline artifact', () => {
    expect(() => createHtmlArtifact({ source: 'inline' })).toThrow('html is required')
  })
})

describe('handleFileClick path detection (normalize + isHtml combo)', () => {
  it('classifies normalized .html path as artifact', () => {
    const path = normalizeWorkspaceFilePath(
      '/workspace/repos/my-repo/dist/index.html',
      '/workspace/repos/my-repo',
    )
    expect(path).toBe('my-repo/dist/index.html')
    expect(isHtmlPath(path)).toBe(true)
  })

  it('classifies normalized .htm path as artifact', () => {
    const path = normalizeWorkspaceFilePath(
      '/workspace/repos/my-repo/public/page.htm',
      '/workspace/repos/my-repo',
    )
    expect(path).toBe('my-repo/public/page.htm')
    expect(isHtmlPath(path)).toBe(true)
  })

  it('does not classify non-HTML path as artifact', () => {
    const path = normalizeWorkspaceFilePath(
      '/workspace/repos/my-repo/src/app.tsx',
      '/workspace/repos/my-repo',
    )
    expect(path).toBe('my-repo/src/app.tsx')
    expect(isHtmlPath(path)).toBe(false)
  })

  it('does not classify relative non-HTML path as artifact', () => {
    expect(isHtmlPath(normalizeWorkspaceFilePath('src/utils.ts'))).toBe(false)
  })

  it('classifies .html path without repo prefix as artifact', () => {
    const path = normalizeWorkspaceFilePath('some-folder/index.html')
    expect(isHtmlPath(path)).toBe(true)
  })
})

describe('getArtifactTitle', () => {
  it('returns file name without extension for .html paths', () => {
    expect(getArtifactTitle('my-repo/dist/index.html')).toBe('index')
  })

  it('returns file name without extension for .htm paths', () => {
    expect(getArtifactTitle('page.htm')).toBe('page')
  })

  it('returns last segment for non-HTML paths', () => {
    expect(getArtifactTitle('some/path/file.txt')).toBe('file.txt')
  })

  it('returns Untitled Artifact for undefined', () => {
    expect(getArtifactTitle(undefined)).toBe('Untitled Artifact')
  })
})

describe('normalizeHtmlPreviewDocument', () => {
  it('adds viewport meta and sizing style to html fragments', () => {
    const result = normalizeHtmlPreviewDocument('<h1>Hello</h1>')

    expect(result).toContain('name="viewport"')
    expect(result).toContain('opencode-html-preview-sizing')
    expect(result).toContain('overflow-y:auto!important')
    expect(result).toContain('<h1>Hello</h1>')
  })

  it('does not duplicate an existing viewport meta tag', () => {
    const result = normalizeHtmlPreviewDocument('<head><meta name="viewport" content="width=device-width"></head>')

    expect(result.match(/name="viewport"/g)).toHaveLength(1)
    expect(result).toContain('opencode-html-preview-sizing')
  })

  it('inserts preview sizing before an existing closing head tag', () => {
    const result = normalizeHtmlPreviewDocument('<html><head><title>Demo</title></head><body>Demo</body></html>')

    expect(result).toContain('<title>Demo</title><meta name="viewport"')
    expect(result).toContain('opencode-html-preview-sizing')
  })
})
