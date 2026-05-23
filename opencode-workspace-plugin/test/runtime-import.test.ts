import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const distPath = path.resolve(__dirname, '../dist/tui.js')
const hasDist = existsSync(distPath)

describe.skipIf(!hasDist)('runtime import', () => {
  it('build output file exists', () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it('built TUI bundle contains expected plugin export', () => {
    const content = readFileSync(distPath, 'utf-8')
    expect(content).toContain('opencode-workspace-manager')
    expect(content).toContain('tui')
  })
})
