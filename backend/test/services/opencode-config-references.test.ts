import { describe, expect, it } from 'vitest'
import { restoreOpenCodeConfigReferences } from '../../src/services/opencode-config-references'

describe('restoreOpenCodeConfigReferences', () => {
  it('keeps unchanged references of a v2 entity and writes edited values', () => {
    const raw = {
      agents: { reviewer: { system: '{file:./prompt.md}', description: 'old' } },
      providers: { acme: { settings: { apiKey: '{env:ACME_KEY}' } } },
    }
    const resolved = {
      agents: { reviewer: { system: 'Prompt text', description: 'old' } },
      providers: { acme: { settings: { apiKey: 'secret' } } },
    }
    const patch = {
      agents: { reviewer: { system: 'Prompt text', description: 'new' } },
      providers: { acme: { settings: { apiKey: 'secret' } } },
    }

    expect(restoreOpenCodeConfigReferences(patch, resolved, raw)).toEqual({
      agents: { reviewer: { system: '{file:./prompt.md}', description: 'new' } },
      providers: { acme: { settings: { apiKey: '{env:ACME_KEY}' } } },
    })
  })

  it('writes an edited value over a reference', () => {
    const raw = { agents: { reviewer: { system: '{file:./prompt.md}' } } }
    const resolved = { agents: { reviewer: { system: 'Prompt text' } } }
    const patch = { agents: { reviewer: { system: 'Rewritten prompt' } } }

    expect(restoreOpenCodeConfigReferences(patch, resolved, raw)).toEqual(patch)
  })

  it('carries references across a rename', () => {
    const raw = { commands: { old: { template: '{file:./cmd.md}' } } }
    const resolved = { commands: { old: { template: 'Run it' } } }
    const patch = { commands: { renamed: { template: 'Run it' }, old: null } }

    expect(restoreOpenCodeConfigReferences(patch, resolved, raw)).toEqual({
      commands: { renamed: { template: '{file:./cmd.md}' }, old: null },
    })
  })

  it('restores references from the v1 definition through renamed fields', () => {
    const raw = {
      agent: { reviewer: { prompt: '{file:./prompt.md}' } },
      provider: { acme: { options: { apiKey: '{env:ACME_KEY}', headers: { Authorization: 'Bearer {env:TOKEN}' } } } },
      mcp: { docs: { type: 'remote', url: 'https://x', headers: { key: '{env:MCP_KEY}' } } },
    }
    const resolved = {
      agents: { reviewer: { system: 'Prompt text' } },
      providers: { acme: { settings: { apiKey: 'secret' }, headers: { Authorization: 'Bearer t' } } },
      mcp: { servers: { docs: { type: 'remote', url: 'https://x', headers: { key: 'm' } } } },
    }
    const patch = {
      agents: { reviewer: { system: 'Prompt text', description: 'added' } },
      providers: { acme: { settings: { apiKey: 'secret' }, headers: { Authorization: 'Bearer t' } } },
      mcp: { servers: { docs: { type: 'remote', url: 'https://x', headers: { key: 'm' } } } },
    }

    expect(restoreOpenCodeConfigReferences(patch, resolved, raw)).toEqual({
      agents: { reviewer: { system: '{file:./prompt.md}', description: 'added' } },
      providers: { acme: { settings: { apiKey: '{env:ACME_KEY}' }, headers: { Authorization: 'Bearer {env:TOKEN}' } } },
      mcp: { servers: { docs: { type: 'remote', url: 'https://x', headers: { key: '{env:MCP_KEY}' } } } },
    })
  })

  it('leaves new entities and non-entity keys unchanged', () => {
    const patch = { agents: { fresh: { system: 'x' } }, theme: 'dark' }

    expect(restoreOpenCodeConfigReferences(patch, { agents: {} }, { agents: {} })).toEqual(patch)
  })
})
