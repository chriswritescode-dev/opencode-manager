import { describe, expect, it } from 'vitest'
import { getFileApiUrl } from './files'
import { encodePathForRoute, getFilePreviewUrl } from './files'

describe('getFilePreviewUrl', () => {
  it('constructs preview URL with encoded path segments', () => {
    const url = getFilePreviewUrl('repo/dir/index.html')
    expect(url).toBe('/api/files/preview/repo/dir/index.html')
  })

  it('encodes spaces per segment', () => {
    const url = getFilePreviewUrl('my repo/file name.html')
    expect(url).toBe('/api/files/preview/my%20repo/file%20name.html')
  })

  it('encodes hash characters per segment', () => {
    const url = getFilePreviewUrl('repo/file#1.html')
    expect(url).toBe('/api/files/preview/repo/file%231.html')
  })
})

describe('encodePathForRoute', () => {
  it('encodes each path segment separately', () => {
    const result = encodePathForRoute('repo/dir/index.html')
    expect(result).toBe('repo/dir/index.html')
  })

  it('encodes special characters per segment', () => {
    const result = encodePathForRoute('my dir/file name.html')
    expect(result).toBe('my%20dir/file%20name.html')
  })
})

describe('getFileApiUrl - existing behavior unchanged', () => {
  it('still returns a URL with path query param', () => {
    const url = getFileApiUrl('repo/dir/index.html')
    expect(url).toContain('/api/files')
    expect(url).toContain('path=repo%2Fdir%2Findex.html')
  })
})
