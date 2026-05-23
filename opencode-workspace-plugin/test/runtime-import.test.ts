import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

describe('runtime import', () => {
  const distPath = path.resolve(__dirname, '../dist/tui.js')

  it('build output file exists', () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it('built TUI bundle contains expected plugin export', () => {
    const content = readFileSync(distPath, 'utf-8')
    expect(content).toContain('opencode-workspace-manager')
    expect(content).toContain('tui')
  })
})
