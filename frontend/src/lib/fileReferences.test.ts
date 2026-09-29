import { describe, it, expect } from 'vitest'
import { detectFileReferences } from './fileReferences'

describe('detectFileReferences', () => {
  it('keeps the leading slash of absolute paths and parses line numbers', () => {
    const [reference] = detectFileReferences('{"path": "/Users/me/workspace/repos/app/src/a.ts:12"}')

    expect(reference.filePath).toBe('/Users/me/workspace/repos/app/src/a.ts')
    expect(reference.lineNumber).toBe(12)
  })

  it('detects relative html and htm paths', () => {
    expect(detectFileReferences('{"path": "./out/report.html", "other": "docs/page.htm"}').map((ref) => ref.filePath))
      .toEqual(['./out/report.html', 'docs/page.htm'])
  })

  it('ignores the path portion of URLs', () => {
    expect(detectFileReferences('fetch https://example.com/assets/app.js')).toEqual([])
  })
})
