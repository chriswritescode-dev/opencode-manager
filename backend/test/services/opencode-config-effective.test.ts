import { describe, expect, it, vi } from 'vitest'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  ClientError,
  openCodeLocation,
  type ConfigEntry,
  type OpenCodeApi,
} from '@opencode-manager/shared/opencode'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { readManagedOpenCodeConfig, readOpenCodeConfigDocuments } from '../../src/services/opencode-config-effective'

function stubApi(entries: ConfigEntry[]) {
  const get = vi.fn<OpenCodeApi['config']['get']>(async () => entries)
  const client = createStubOpenCodeClient({ api: { config: { get } } })
  return { api: client.api, get }
}

describe('readOpenCodeConfigDocuments', () => {
  it('keys document entries by resolved path for the requested directory', async () => {
    const { api, get } = stubApi([
      { type: 'document', path: '/directory/./opencode.json', info: { shell: 'bash' } },
      { type: 'document', info: { shell: 'pathless' } },
    ])

    const documents = await readOpenCodeConfigDocuments(api, '/directory')

    expect([...documents.keys()]).toEqual(['/directory/opencode.json'])
    expect(documents.get('/directory/opencode.json')).toEqual({ shell: 'bash' })
    expect(get).toHaveBeenCalledWith(openCodeLocation('/directory'))
  })
})

describe('readManagedOpenCodeConfig', () => {
  it('merges only the documents whose path is a Manager source, in source order', async () => {
    const { api, get } = stubApi([
      {
        type: 'document',
        path: '/workspace/config/opencode.json',
        info: { shell: 'bash', mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } } },
      },
      {
        type: 'document',
        path: '/workspace/config/opencode.jsonc',
        info: { update: 'auto', mcp: { servers: { remote: { type: 'remote', url: 'https://remote.example.com' } } } },
      },
      { type: 'document', path: '/workspace/unmanaged/opencode.json', info: { shell: 'ignored' } },
      { type: 'document', info: { shell: 'pathless' } },
    ])

    const info = await readManagedOpenCodeConfig(api, [
      { path: '/workspace/config/opencode.json' },
      { path: '/workspace/config/opencode.jsonc' },
    ])

    expect(info).toEqual({
      shell: 'bash',
      update: 'auto',
      mcp: {
        servers: {
          local: { type: 'local', command: ['npx', 'local'] },
          remote: { type: 'remote', url: 'https://remote.example.com' },
        },
      },
    })
    expect(get).toHaveBeenCalledWith(openCodeLocation(getWorkspacePath()))
  })

  it('resolves both the source and reported path before matching', async () => {
    const { api } = stubApi([
      {
        type: 'document',
        path: '/workspace/config/./opencode.json',
        info: { shell: 'bash' },
      },
    ])

    await expect(
      readManagedOpenCodeConfig(api, [{ path: '/workspace/config/opencode.json' }]),
    ).resolves.toEqual({ shell: 'bash' })
  })

  it('returns the converted v1 entries the server reports for a Manager file', async () => {
    const { api } = stubApi([
      {
        type: 'document',
        path: '/workspace/config/opencode.json',
        info: { agents: { reviewer: { mode: 'subagent' } } },
      },
    ])

    await expect(
      readManagedOpenCodeConfig(api, [{ path: '/workspace/config/opencode.json' }]),
    ).resolves.toEqual({ agents: { reviewer: { mode: 'subagent' } } })
  })

  it('returns an empty config when no reported document matches a Manager source', async () => {
    const { api } = stubApi([
      { type: 'document', path: '/workspace/other/opencode.json', info: { shell: 'bash' } },
    ])

    await expect(
      readManagedOpenCodeConfig(api, [{ path: '/workspace/config/opencode.json' }]),
    ).resolves.toEqual({})
  })

  it('propagates client errors', async () => {
    const get = vi.fn<OpenCodeApi['config']['get']>(async () => {
      throw new ClientError('Transport')
    })
    const client = createStubOpenCodeClient({ api: { config: { get } } })

    await expect(
      readManagedOpenCodeConfig(client.api, [{ path: '/workspace/config/opencode.json' }]),
    ).rejects.toBeInstanceOf(ClientError)
  })
})
