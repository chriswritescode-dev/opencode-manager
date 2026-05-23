import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'

describe('runtime import', () => {
  it('loads built plugin without errors', () => {
    const distPath = path.resolve(__dirname, '../dist/index.js')
    const result = execSync(
      `node -e "import('${distPath}').then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })"`,
      { encoding: 'utf-8' },
    )
    expect(result).toBe('')
  })
})
