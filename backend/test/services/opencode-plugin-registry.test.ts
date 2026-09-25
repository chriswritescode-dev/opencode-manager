import { describe, it, expect } from 'vitest'
import { buildGhEnvPluginSource } from '../../src/services/opencode-gh-env-plugin'
import { buildManagerToolPluginSource } from '../../src/services/opencode-manager-tool-plugin'
import { buildSandboxPluginSource } from '../../src/services/opencode-sandbox-plugin'

describe('managed OpenCode plugin id wiring', () => {
  it('bakes the id each source builder receives instead of hard-coding it', () => {
    expect(buildGhEnvPluginSource('custom.gh-env')).toContain("id: 'custom.gh-env'")
    expect(buildManagerToolPluginSource('custom.manager')).toContain("id: 'custom.manager'")
    expect(buildSandboxPluginSource('custom.sandbox', '/shim', '/config/service.json')).toContain("id: 'custom.sandbox'")
  })
})
