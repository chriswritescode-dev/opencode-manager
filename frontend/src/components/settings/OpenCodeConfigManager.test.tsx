import { beforeAll, describe, it, expect } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import type { OpenCodeConfigFile, OpenCodeImportStatus } from '@/api/types/settings'
import { makeOpenCodeConfigFile, makeOpenCodeConfigSource } from '@/test/fixtures/opencode-config'
import { makeHealthResponse } from '@/test/fixtures/api'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const defaultContent = {
  provider: {
    openai: {
      name: 'OpenAI',
      models: {
        'gpt-4o': { name: 'GPT-4o' },
      },
    },
  },
}

const defaultManagedInfo = {
  providers: {
    openai: {
      name: 'OpenAI',
      models: {
        'gpt-4o': { name: 'GPT-4o', modelID: 'gpt-4o' },
      },
    },
  },
}

const defaultConfig = makeOpenCodeConfigFile({
  path: '/workspace/.opencode/opencode.json',
  rawContent: JSON.stringify(defaultContent, null, 2),
  content: defaultContent,
})

const defaultImportStatus: OpenCodeImportStatus = {
  configSourcePath: null,
  configSourcePaths: [],
  stateSourcePath: null,
  workspaceConfigPath: '/workspace/.opencode/opencode.json',
  workspaceConfigPathsToRemove: [],
  workspaceStatePath: '/workspace/.opencode/state/opencode',
  workspaceStateExists: false,
}

interface ManagedConfigOptions {
  info?: typeof defaultManagedInfo
  pending?: boolean
  response?: FetchRouteResult
}

interface ConfigServerOptions {
  config?: OpenCodeConfigFile
  managed?: ManagedConfigOptions
  importStatus?: OpenCodeImportStatus
  directoryFiles?: {
    agents?: Array<{ kind: 'agents'; name: string; relativePath: string }>
    commands?: Array<{ kind: 'commands'; name: string; relativePath: string }>
  }
  restartPending?: boolean
  activeSessionCount?: number
  patchResponses?: OpenCodeConfigFile[]
  updateResponses?: OpenCodeConfigFile[]
  patchError?: () => void
  deferredUpdate?: boolean
}

function createConfigServer(options: ConfigServerOptions = {}) {
  let config = options.config ?? defaultConfig
  const patchResponses = [...(options.patchResponses ?? [])]
  const updateResponses = [...(options.updateResponses ?? [])]
  let releaseUpdate: (() => void) | undefined
  let updateGate: Promise<void> | null = options.deferredUpdate
    ? new Promise<void>((resolve) => { releaseUpdate = resolve })
    : null

  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/settings/opencode-config', respond: () => ({ json: config }) },
    {
      method: 'PUT',
      path: '/api/settings/opencode-config',
      respond: async () => {
        if (updateGate) {
          await updateGate
          updateGate = null
        }
        const next = updateResponses.shift() ?? config
        config = next
        return { json: next }
      },
    },
    {
      method: 'PATCH',
      path: '/api/settings/opencode-config',
      respond: async () => {
        if (options.patchError) options.patchError()
        const next = patchResponses.shift() ?? config
        config = next
        return { json: next }
      },
    },
    {
      method: 'GET',
      path: '/api/settings/opencode-config/managed',
      respond: () => {
        if (options.managed?.pending) return new Promise<FetchRouteResult>(() => undefined)
        if (options.managed?.response) return options.managed.response
        return { json: { info: options.managed?.info ?? defaultManagedInfo } }
      },
    },
    { method: 'GET', path: '/api/settings/skills', respond: () => ({ json: [] }) },
    {
      method: 'GET',
      path: '/api/settings/opencode-import/status',
      respond: () => ({ json: options.importStatus ?? defaultImportStatus }),
    },
    {
      method: 'GET',
      path: '/api/settings/opencode-directory-files',
      respond: (request) => {
        const kind = request.searchParams.get('kind')
        const files = kind === 'commands'
          ? options.directoryFiles?.commands ?? []
          : options.directoryFiles?.agents ?? []
        return { json: files }
      },
    },
    { method: 'GET', path: '/api/settings/agents-md', respond: () => ({ json: { content: '# Agent Instructions' } }) },
    { method: 'PUT', path: '/api/settings/agents-md', respond: () => ({ json: { success: true, restartRequired: false } }) },
    {
      method: 'GET',
      path: '/api/health',
      respond: () => ({ json: makeHealthResponse({ opencodeRestartPending: options.restartPending ?? false }) }),
    },
    { method: 'GET', path: '/api/settings/opencode-active-sessions', respond: () => ({ json: { count: options.activeSessionCount ?? 2, sessions: [] } }) },
    { method: 'POST', path: '/api/settings/opencode-restart', respond: () => ({ json: { success: true, message: 'ok' } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/mcp',
      respond: () => ({ json: { location: { directory: '/workspace/.opencode' }, data: [] } }),
    },
    { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
    { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
    { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
    { method: 'GET', path: '/api/settings/opencode-discover-models', respond: () => ({ json: { models: [], cached: false } }) },
  ]

  return {
    routes,
    setConfig: (next: OpenCodeConfigFile) => {
      config = next
    },
    releaseUpdate: () => releaseUpdate?.(),
  }
}

async function renderManager(options: ConfigServerOptions = {}) {
  const server = createConfigServer(options)
  const result = renderWithProviders(<OpenCodeConfigManager />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: server.routes,
  })
  await screen.findByText('File location and updated time')
  return { ...result, ...server }
}

function configEditButton() {
  return screen.getAllByRole('button', { name: 'Edit' }).find((button) => button.querySelector('.lucide-square-pen'))
}

async function openSection(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('button', { name }))
}

describe('OpenCodeConfigManager', () => {
  beforeAll(() => {
    installPointerCapture()
  })

  it('shows uploaded command and agent directory files in settings', async () => {
    const user = userEvent.setup()
    await renderManager({
      directoryFiles: {
        commands: [{ kind: 'commands', name: 'deploy', relativePath: 'project/deploy.md' }],
        agents: [{ kind: 'agents', name: 'planner', relativePath: 'team/planner.md' }],
      },
    })

    await waitFor(() => {
      expect(screen.getAllByText('1 configured').length).toBeGreaterThanOrEqual(2)
    })

    await openSection(user, /Commands/i)
    expect(await screen.findByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: project/deploy.md')).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find((button) => button.textContent?.startsWith('Agents'))
    if (!agentsButton) throw new Error('agents section not found')
    await user.click(agentsButton)
    expect(await screen.findByText('planner')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: team/planner.md')).toBeInTheDocument()
  })

  it('optimistic delete saves without eager restart modal', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({ patchResponses: [{ ...defaultConfig, restartRequired: true }] })

    await openSection(user, /Models/i)
    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toMatchObject({
        patch: { providers: { openai: { models: { 'gpt-4o': null } } } },
      }),
    )
    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('deferred restart banner triggers server restart', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({ restartPending: true })

    await user.click(await screen.findByRole('button', { name: /restart now/i }))
    await screen.findByText('Restart OpenCode Server?')

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /restart now/i }))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(1))
  })

  it('rolls the optimistic delete back on failure', async () => {
    const user = userEvent.setup()
    await renderManager({
      patchError: () => {
        throw new Error('boom')
      },
    })

    await openSection(user, /Models/i)
    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(await screen.findByText('Failed to update config')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('keeps the AGENTS.md editor mounted while its disclosure toggles', async () => {
    const user = userEvent.setup()
    await renderManager()

    const header = screen.getByRole('button', { name: /Global Agent Instructions/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    const content = document.getElementById(header.getAttribute('aria-controls') ?? '')
    expect(content).toHaveClass('hidden')
    expect(await screen.findByLabelText('AGENTS.md content')).toBeInTheDocument()

    const chevron = header.querySelector('.lucide-chevron-down')
    expect(chevron).not.toHaveClass('rotate-180')

    await user.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(content).toHaveClass('block')
    expect(chevron).toHaveClass('rotate-180')
    expect(chevron).not.toHaveClass('rotate-90')
    expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument()

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveClass('hidden')
    expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument()
  })

  it('wires every disclosure header to a unique content id', async () => {
    await renderManager()

    const headers = screen.getAllByRole('button').filter(
      (button) => button.hasAttribute('aria-controls') && !button.hasAttribute('aria-haspopup'),
    )
    expect(headers).toHaveLength(7)
    headers.forEach((header) => expect(header).toHaveAttribute('aria-expanded'))

    const contentIds = headers.map((header) => header.getAttribute('aria-controls') ?? '')
    expect(new Set(contentIds).size).toBe(7)
    contentIds.forEach((id) => expect(document.getElementById(id)).toBeInTheDocument())
  })

  it('labels the config file actions and exposes its metadata', async () => {
    await renderManager()

    expect(await screen.findByText('opencode.json')).toBeInTheDocument()
    expect(configEditButton()).toBeDefined()
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByText('File location and updated time')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.opencode/opencode.json')).toBeInTheDocument()
    expect(screen.getByText(`Updated: ${new Date(defaultConfig.updatedAt).toLocaleString()}`)).toBeInTheDocument()
  })

  it('sends the source and expected revision and replaces the cache with the returned snapshot for a raw save', async () => {
    const configWithRaw: OpenCodeConfigFile = {
      ...defaultConfig,
      rawContent: '{\n  "theme": "system"\n}',
    }
    const savedConfig: OpenCodeConfigFile = {
      ...configWithRaw,
      rawContent: '{\n  "theme": "dark"\n}',
      revision: 'rev-2',
      updatedAt: 2,
    }

    const user = userEvent.setup()
    const { fetchFake, queryClient } = await renderManager({ config: configWithRaw, updateResponses: [savedConfig] })

    const editButton = configEditButton()
    if (!editButton) throw new Error('edit button not found')
    await user.click(editButton)
    const managedReadsBeforeSave = fetchFake.findRequests('GET', '/api/settings/opencode-config/managed').length

    const textarea = await screen.findByLabelText('Config content')
    const next = `${configWithRaw.rawContent} `
    fireEvent.change(textarea, { target: { value: next } })

    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', '/api/settings/opencode-config')?.body).toEqual({
        content: next,
        source: 'opencode.json',
        expectedRevision: 'rev-1',
      }),
    )
    const cached = queryClient.getQueryData(['opencode-config', 'file'])
    expect(cached).toMatchObject({ revision: 'rev-2', rawContent: '{\n  "theme": "dark"\n}' })
    await waitFor(() =>
      expect(fetchFake.findRequests('GET', '/api/settings/opencode-config/managed').length).toBeGreaterThan(managedReadsBeforeSave),
    )
    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())
  })

  it('preserves an open draft when the config query refreshes in the background', async () => {
    const user = userEvent.setup()
    const { fetchFake, queryClient, setConfig } = await renderManager()

    const editButton = configEditButton()
    if (!editButton) throw new Error('edit button not found')
    await user.click(editButton)

    const textarea = await screen.findByLabelText('Config content')
    const draft = `${defaultConfig.rawContent}\n// draft\n`
    fireEvent.change(textarea, { target: { value: draft } })

    const refreshedContent = { theme: 'dark' }
    const refreshedRaw = JSON.stringify(refreshedContent, null, 2)
    setConfig({
      ...defaultConfig,
      content: refreshedContent,
      rawContent: refreshedRaw,
      sources: [
        makeOpenCodeConfigSource({
          name: 'opencode.json',
          path: defaultConfig.path,
          rawContent: refreshedRaw,
          content: refreshedContent,
          updatedAt: 2,
        }),
      ],
      updatedAt: 2,
    })

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opencode-config', 'file'] })
    })

    await waitFor(() => {
      expect(screen.getByText(`Updated: ${new Date(2).toLocaleString()}`)).toBeInTheDocument()
    })
    expect(fetchFake.findRequests('GET', '/api/settings/opencode-config')).toHaveLength(2)
    expect(textarea).toHaveValue(draft)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(textarea).toHaveValue(draft)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())

    const reopenButton = configEditButton()
    if (!reopenButton) throw new Error('edit button not found')
    await user.click(reopenButton)

    expect(await screen.findByLabelText('Config content')).toHaveValue(refreshedRaw)
  })

  it('sends the expected revision for structured updates', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({ patchResponses: [{ ...defaultConfig, restartRequired: true }] })

    await openSection(user, /Models/i)
    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toMatchObject({
        patch: { providers: { openai: { models: { 'gpt-4o': null } } } },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('resolves the add-server expected revision from the query cache', async () => {
    const cachedConfig = { ...defaultConfig, revision: 'rev-A' }
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      config: cachedConfig,
      patchResponses: [{ ...cachedConfig, restartRequired: true }],
    })

    await user.click(screen.getByRole('button', { name: /Add Server/i }))
    await user.type(await screen.findByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toMatchObject({
        expectedRevision: 'rev-A',
        patch: {
          mcp: {
            servers: {
              filesystem: expect.objectContaining({
                type: 'local',
                command: ['npx', 'server-filesystem', '/tmp'],
              }),
            },
          },
        },
      }),
    )
  })

  it('deletes a configured MCP server through an mcp.servers patch', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: { info: { mcp: { servers: { filesystem: { type: 'local', command: ['npx', 'server'] } } } } },
      patchResponses: [{ ...defaultConfig, revision: 'rev-2' }],
    })

    await openSection(user, /MCP Servers/i)
    await user.click(await screen.findByLabelText('Actions for Filesystem'))
    await user.click(screen.getByText('Delete Server'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toEqual({
        patch: { mcp: { servers: { filesystem: null } } },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('sends the revision from the previous save on the next structured save', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: {
        info: {
          providers: {
            openai: {
              name: 'OpenAI',
              models: {
                'gpt-4o': { name: 'GPT-4o' },
                'gpt-3.5': { name: 'GPT-3.5' },
              },
            },
          },
        },
      },
      patchResponses: [{ ...defaultConfig, revision: 'rev-2' }, { ...defaultConfig, revision: 'rev-3' }],
    })

    await openSection(user, /Models/i)
    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))
    await waitFor(() => expect(fetchFake.findRequests('PATCH', '/api/settings/opencode-config')).toHaveLength(1))
    expect(fetchFake.findRequests('PATCH', '/api/settings/opencode-config')[0].body).toMatchObject({ expectedRevision: 'rev-1' })

    await user.click(screen.getByLabelText('Actions for GPT-3.5'))
    await user.click(screen.getByText('Delete'))
    await waitFor(() => expect(fetchFake.findRequests('PATCH', '/api/settings/opencode-config')).toHaveLength(2))
    expect(fetchFake.findRequests('PATCH', '/api/settings/opencode-config')[1].body).toMatchObject({ expectedRevision: 'rev-2' })
  })

  it('adds a model to a new API provider through a providers patch', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: { info: {} },
      patchResponses: [{ ...defaultConfig, revision: 'rev-2' }],
    })

    await openSection(user, /Models/i)
    await user.click(screen.getByRole('button', { name: /Add Model/i }))

    fireEvent.change(await screen.findByPlaceholderText('e.g., my-provider'), { target: { value: 'my-provider' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., My Provider'), { target: { value: 'My Provider' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), { target: { value: 'https://api.example.com/v1' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., qwen-3.5-27b'), { target: { value: 'gpt-5' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., MiniMax-M2.7'), { target: { value: 'gpt-5-model' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., Qwen3.5-27B'), { target: { value: 'GPT-5' } })

    const createButton = screen.getByRole('button', { name: /create/i })
    await waitFor(() => expect(createButton).not.toBeDisabled())
    await user.click(createButton)

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toEqual({
        patch: {
          providers: {
            'my-provider': {
              name: 'My Provider',
              settings: { baseURL: 'https://api.example.com/v1' },
              models: {
                'gpt-5': expect.objectContaining({ modelID: 'gpt-5-model', name: 'GPT-5' }),
              },
            },
          },
        },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('saves an edited model under providers when the managed response converted a v1 entry', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: {
        info: {
          providers: {
            openai: {
              name: 'OpenAI',
              models: { 'gpt-4o': { name: 'GPT-4o', modelID: 'gpt-4o' } },
            },
          },
        },
      },
      patchResponses: [{ ...defaultConfig, revision: 'rev-2' }],
    })

    await openSection(user, /Models/i)
    await user.click(await screen.findByText('GPT-4o'))

    fireEvent.change(await screen.findByPlaceholderText('e.g., Qwen3.5-27B'), { target: { value: 'GPT-4o Updated' } })
    await user.click(screen.getByRole('button', { name: /update/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toEqual({
        patch: {
          providers: {
            openai: {
              name: 'OpenAI',
              models: {
                'gpt-4o': expect.objectContaining({ name: 'GPT-4o Updated', modelID: 'gpt-4o' }),
              },
            },
          },
        },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('keeps a converted provider and its sibling models when deleting one model', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: {
        info: {
          providers: {
            p: {
              name: 'Provider P',
              settings: { baseURL: 'http://x' },
              models: {
                a: { name: 'Model A' },
                b: { name: 'Model B' },
              },
            },
          },
        },
      },
      patchResponses: [{ ...defaultConfig, revision: 'rev-2' }],
    })

    await openSection(user, /Models/i)
    await user.click(await screen.findByLabelText('Actions for Model A'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toEqual({
        patch: {
          providers: {
            p: {
              name: 'Provider P',
              settings: { baseURL: 'http://x' },
              models: {
                a: null,
                b: { name: 'Model B' },
              },
            },
          },
        },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('reports a comment-only raw save as applied without a restart', async () => {
    const configWithRaw: OpenCodeConfigFile = {
      ...defaultConfig,
      rawContent: '{\n  // comment only\n  "theme": "system"\n}',
    }
    const user = userEvent.setup()
    await renderManager({
      config: configWithRaw,
      updateResponses: [{ ...configWithRaw, restartRequired: false, revision: 'rev-2' }],
    })

    const editButton = configEditButton()
    if (!editButton) throw new Error('edit button not found')
    await user.click(editButton)

    const textarea = await screen.findByLabelText('Config content')
    fireEvent.change(textarea, { target: { value: `${configWithRaw.rawContent}\n// another\n` } })
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(await screen.findByText('Configuration updated')).toBeInTheDocument()
    expect(
      screen.queryByText('Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.'),
    ).not.toBeInTheDocument()
  })

  it('asks for a restart after a semantic structured change', async () => {
    const user = userEvent.setup()
    await renderManager({ patchResponses: [{ ...defaultConfig, restartRequired: true }] })

    await openSection(user, /Models/i)
    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(
      await screen.findByText('Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.'),
    ).toBeInTheDocument()
  })

  it('does not reset an in-flight save when the config query refreshes in the background', async () => {
    const user = userEvent.setup()
    const { queryClient, setConfig, releaseUpdate } = await renderManager({ deferredUpdate: true })

    const editButton = configEditButton()
    if (!editButton) throw new Error('edit button not found')
    await user.click(editButton)

    const textarea = await screen.findByLabelText('Config content')
    const draft = `${defaultConfig.rawContent}\n// draft\n`
    fireEvent.change(textarea, { target: { value: draft } })

    const updateButton = screen.getByRole('button', { name: 'Update' })
    await user.click(updateButton)
    await waitFor(() => expect(updateButton).toBeDisabled())

    const refreshedContent = { theme: 'dark' }
    setConfig({
      ...defaultConfig,
      content: refreshedContent,
      rawContent: JSON.stringify(refreshedContent, null, 2),
      updatedAt: 2,
    })

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opencode-config', 'file'] })
    })

    await waitFor(() => {
      expect(screen.getByText(`Updated: ${new Date(2).toLocaleString()}`)).toBeInTheDocument()
    })
    expect(updateButton).toBeDisabled()
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveValue(draft)

    releaseUpdate()

    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())
  })

  it('renders host import collapsed after the configuration file until expanded', async () => {
    const user = userEvent.setup()
    await renderManager()

    const importToggle = screen.getByRole('button', { name: /Existing OpenCode Host Import/i })
    expect(importToggle).toHaveAttribute('aria-expanded', 'false')
    const importContent = document.getElementById(importToggle.getAttribute('aria-controls') ?? '')
    expect(importContent).toHaveClass('hidden')

    const configFileName = screen.getByText('opencode.json')
    expect(configFileName.compareDocumentPosition(importToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(importToggle)
    expect(importToggle).toHaveAttribute('aria-expanded', 'true')
    expect(importContent).toHaveClass('block')
    expect(screen.getByRole('button', { name: /Import From Host/i })).toBeInTheDocument()
  })

  it('warns that importing removes workspace config files absent on the host', async () => {
    await renderManager({
      importStatus: {
        configSourcePath: '/import/opencode-config/opencode.jsonc',
        configSourcePaths: ['/import/opencode-config/opencode.json', '/import/opencode-config/opencode.jsonc'],
        stateSourcePath: null,
        workspaceConfigPath: '/workspace/.config/opencode/opencode.json',
        workspaceConfigPathsToRemove: ['/workspace/.config/opencode/opencode.jsonc'],
        workspaceStatePath: '/workspace/.opencode/state/opencode',
        workspaceStateExists: false,
      },
    })

    expect(await screen.findByText(/These files will be removed: opencode.jsonc\./)).toBeInTheDocument()
    expect(screen.getByText(/Host files imported: opencode\.json, opencode\.jsonc\./)).toBeInTheDocument()
  })

  it('does not warn about removals when the host has every workspace config file', async () => {
    await renderManager({
      importStatus: {
        configSourcePath: '/import/opencode-config/opencode.json',
        configSourcePaths: ['/import/opencode-config/opencode.json'],
        stateSourcePath: null,
        workspaceConfigPath: '/workspace/.config/opencode/opencode.json',
        workspaceConfigPathsToRemove: [],
        workspaceStatePath: '/workspace/.opencode/state/opencode',
        workspaceStateExists: false,
      },
    })

    expect(screen.queryByText(/These files will be removed/)).not.toBeInTheDocument()
  })

  it('shows the config file name and an invalid badge when the file is invalid', async () => {
    await renderManager({
      config: {
        ...defaultConfig,
        isValid: false,
        validationIssues: [{ path: 'model', message: 'Expected string' }],
      },
    })

    expect(await screen.findByText('opencode.json')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.opencode/opencode.json')).toBeInTheDocument()
    expect(screen.getByText('Invalid Config')).toBeInTheDocument()
    expect(screen.getByText('model')).toBeInTheDocument()
  })

  it('hides the multi-source notice when only one config file is present', async () => {
    await renderManager()

    expect(screen.queryByText('Multiple configuration files are merged')).not.toBeInTheDocument()
  })

  it('lists merged config files in override order and names the structured write target', async () => {
    await renderManager({
      config: makeOpenCodeConfigFile({
        path: '/workspace/.config/opencode/opencode.jsonc',
        rawContent: '{}',
        sources: [
          makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json' }),
          makeOpenCodeConfigSource({ name: 'opencode.jsonc', path: '/workspace/.config/opencode/opencode.jsonc' }),
        ],
      }),
    })

    const notice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]')
    if (!(notice instanceof HTMLElement)) throw new Error('notice not found')
    expect(notice).toHaveTextContent('opencode.json, opencode.jsonc')
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')
    expect(notice).toHaveTextContent('For simpler configuration, consolidate the settings you need into one file, then remove redundant files after verifying the result.')
  })

  it('lists agents and commands from the managed config query', async () => {
    const user = userEvent.setup()
    await renderManager({
      managed: {
        info: {
          agents: { reviewer: { system: 'Review code', description: 'Reviews code', mode: 'subagent' } },
          commands: { deploy: { template: 'Deploy it', description: 'Deploys the app' } },
        },
      },
    })

    await openSection(user, /Commands/i)
    expect(await screen.findByText('deploy')).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find((button) => button.textContent?.startsWith('Agents'))
    if (!agentsButton) throw new Error('agents section not found')
    await user.click(agentsButton)
    expect(await screen.findByText('reviewer')).toBeInTheDocument()
  })

  it('shows the unavailable notice and keeps the raw editor reachable when OpenCode is down', async () => {
    const user = userEvent.setup()
    await renderManager({ managed: { response: { status: 503, json: { error: 'OpenCode server unavailable' } } } })

    await openSection(user, /Commands/i)
    expect(
      await screen.findByText(/OpenCode is not running, so the configured commands cannot be listed/),
    ).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find((button) => button.textContent?.startsWith('Agents'))
    if (!agentsButton) throw new Error('agents section not found')
    await user.click(agentsButton)
    expect(
      await screen.findByText(/OpenCode is not running, so the configured agents cannot be listed/),
    ).toBeInTheDocument()

    const editButton = configEditButton()
    if (!editButton) throw new Error('edit button not found')
    await user.click(editButton)
    expect(await screen.findByLabelText('Config content')).toBeInTheDocument()
  })

  it('shows an error notice instead of empty managed sections when the managed config request fails', async () => {
    await renderManager({ managed: { response: { status: 502, json: { error: 'Bad Gateway' } } } })

    expect(await screen.findAllByText('OpenCode configuration unavailable')).toHaveLength(4)
    expect(screen.getAllByText('Bad Gateway')).toHaveLength(4)

    const commandsHeader = screen.getByRole('button', { name: /^Commands/ })
    expect(commandsHeader).toHaveTextContent('Unavailable')
    expect(commandsHeader).not.toHaveTextContent('0 configured')
    expect(screen.queryByText('No commands configured')).not.toBeInTheDocument()
    expect(screen.queryByText('No agents configured')).not.toBeInTheDocument()
    expect(screen.queryByText('No models configured')).not.toBeInTheDocument()
  })

  it('shows a loading state instead of empty managed sections while the managed config request is pending', async () => {
    await renderManager({ managed: { pending: true } })

    expect(await screen.findAllByText('Loading configuration...')).toHaveLength(4)
    expect(screen.getByRole('button', { name: /^Commands/ })).toHaveTextContent('Loading...')
    expect(screen.queryByText('No commands configured')).not.toBeInTheDocument()
  })

  it('saves an agent with an entity patch through the managed config endpoint', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: { info: { agents: { reviewer: { system: 'Review code', mode: 'subagent' } } } },
    })

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find((button) => button.textContent?.startsWith('Agents'))
    if (!agentsButton) throw new Error('agents section not found')
    await user.click(agentsButton)
    await user.click(await screen.findByText('reviewer'))

    const prompt = await screen.findByLabelText('Prompt')
    await user.clear(prompt)
    await user.type(prompt, 'Updated')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toMatchObject({
        patch: { agents: { reviewer: { system: 'Updated', mode: 'subagent' } } },
        expectedRevision: 'rev-1',
      }),
    )
  })

  it('sends null for cleared command fields and a disabled subagent', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderManager({
      managed: {
        info: {
          commands: {
            review: {
              template: 'Review this code',
              description: 'Reviews changes',
              agent: 'reviewer',
              model: 'openai/gpt-5',
              subagent: true,
            },
          },
        },
      },
    })

    await openSection(user, /Commands/i)
    await user.click(await screen.findByText('review'))

    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Description'))
    await user.clear(within(dialog).getByLabelText('Agent (optional)'))
    await user.clear(within(dialog).getByLabelText('Model (optional)'))
    await user.click(within(dialog).getByRole('switch'))
    await user.click(within(dialog).getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings/opencode-config')?.body).toEqual({
        patch: {
          commands: {
            review: {
              template: 'Review this code',
              description: null,
              agent: null,
              model: null,
              subagent: null,
            },
          },
        },
        expectedRevision: 'rev-1',
      }),
    )
  })
})
