import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { verifiedManagedCatalogPlugins } from '../../src/services/opencode/plugin-registry'
import { sandboxShellShimPath } from '../../src/services/sandbox/shell-shim'
import { getOpenCodeServiceSettingsPath } from '../../src/services/opencode-service-mode'
import { buildGhEnvPluginSource } from '../../src/services/opencode-gh-env-plugin'
import { buildManagerToolPluginSource } from '../../src/services/opencode-manager-tool-plugin'
import { buildSandboxPluginSource } from '../../src/services/opencode-sandbox-plugin'

describe('managed OpenCode plugin id wiring', () => {
  it('attests exact generated plugin content and installation paths', async () => {
    const configHome = '/managed-config'
    const read = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce(buildGhEnvPluginSource('ocm.gh-env'))
      .mockResolvedValueOnce(buildManagerToolPluginSource('ocm.manager'))
      .mockResolvedValueOnce(buildSandboxPluginSource('ocm.sandbox', sandboxShellShimPath(configHome), getOpenCodeServiceSettingsPath()))
    try {
      expect(await verifiedManagedCatalogPlugins(configHome)).toEqual([
        { id: 'ocm.gh-env', path: '/managed-config/opencode/plugins/ocm-gh-env.js' },
        { id: 'ocm.manager', path: '/managed-config/opencode/plugins/ocm-manager.js' },
        { id: 'ocm.sandbox', path: '/managed-config/opencode/plugins/ocm-sandbox.js' },
      ])
      expect(read).toHaveBeenCalledWith('/managed-config/opencode/plugins/ocm-manager.js', 'utf8')
    } finally {
      read.mockRestore()
    }
  })

  it('does not exempt changed, missing or substituted plugins', async () => {
    const read = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce(buildGhEnvPluginSource('different.id'))
      .mockResolvedValueOnce(buildManagerToolPluginSource('ocm.manager') + '\nchanged')
      .mockRejectedValueOnce(new Error('missing'))
    try {
      expect(await verifiedManagedCatalogPlugins('/managed-config')).toEqual([])
    } finally {
      read.mockRestore()
    }
  })

  it('bakes the id each source builder receives instead of hard-coding it', () => {
    expect(buildGhEnvPluginSource('custom.gh-env')).toContain("id: 'custom.gh-env'")
    expect(buildManagerToolPluginSource('custom.manager')).toContain("id: 'custom.manager'")
    expect(buildSandboxPluginSource('custom.sandbox', '/shim', '/config/service.json')).toContain("id: 'custom.sandbox'")
  })
})
