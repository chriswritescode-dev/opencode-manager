import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getProviders } from './providers'
import { createSession, getSession, listSessionMessages, sendPrompt, switchSessionModel } from './opencode'
import { selectInteractiveModel, selectEffectiveModelRef, type SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { resolveOpenCodeModel } from '../../../backend/src/services/opencode-models'
import { createOpenCodeApi } from '@opencode-manager/shared/opencode'

vi.mock('@/config', () => ({ API_BASE_URL: '', OPENCODE_API_ENDPOINT: '/api/opencode' }))
vi.mock('@/hooks/useMobile', () => ({ isMobileViewport: () => false }))

const directory = '/catalog-test'
const requests: Array<{ path: string; query: Record<string, string>; body: unknown }> = []
let config: unknown[] = []
let plugins: unknown[] = []
let failConfig = false
let selected: unknown
const providers = ['minimax', 'minimax-cn', 'opencode', 'openrouter'].map((id) => ({ id, name: id, activation: 'enabled' }))
const routes = [
  ['minimax', 'MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-M3.1-Flash'],
  ['minimax-cn', 'MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-M3.1-Flash'],
  ['opencode', 'minimax-m2.7', 'minimax-m3', 'minimax-m3.1-flash-free'],
  ['openrouter', 'minimax/minimax-m2.7', 'minimax/minimax-m3', 'minimax/minimax-m3.1-flash:free'],
]
const models = routes.flatMap(([providerID, ...ids]) => ids.map((id) => ({
  providerID, id, modelID: id, name: id, enabled: true, status: 'active',
  capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
  variants: [{ id: 'high', settings: { reasoning_effort: 'high' } }],
  time: { released: 0 }, limit: { context: 1000000, output: 524288 }, cost: [],
})))
const history: SessionMessageInfo[] = [{ id: 'saved', type: 'assistant', time: { created: 1 },
  agent: 'build', model: { providerID: 'minimax', id: 'MiniMax-M2.7' }, content: [
    { type: 'reasoning', text: 'retained reasoning', state: { signature: 'opaque' } },
    { type: 'tool', id: 'call-1', name: 'inspect', time: { created: 1 },
      state: { status: 'completed', input: { file: 'a' }, content: [{ type: 'text', text: 'ok' }] } },
    { type: 'text', text: 'saved answer' },
  ] }]
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost')
  let text = ''
  for await (const chunk of req) text += chunk
  const body = text ? JSON.parse(text) : undefined
  const path = url.pathname.replace(/^\/api\/opencode/, '')
  requests.push({ path, query: Object.fromEntries(url.searchParams), body })
  const send = (value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
  if (path === '/api/config') {
    if (failConfig) { res.statusCode = 500; res.end(); return }
    return send(config)
  }
  if (path === '/api/plugin') return send({ location: { directory }, data: plugins })
  if (path === '/api/model') return send({ location: { directory }, data: models })
  if (path === '/api/model/default') return send({ location: { directory }, data: models[0] })
  if (path === '/api/provider') return send({ location: { directory }, data: providers })
  if (path === '/api/session' && req.method === 'POST') { selected = body.model; return send({ data: { id: 'test', model: selected } }) }
  if (path === '/api/session/test') return send({ data: { id: 'test', model: selected } })
  if (path === '/api/session/test/model') { selected = body.model; res.statusCode = 204; res.end(); return }
  if (path === '/api/session/test/prompt') return send({ data: { id: 'prompt' } })
  if (path === '/api/session/test/message') return send({ data: history, cursor: {} })
  res.statusCode = 404; res.end()
})
let origin: string

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  vi.stubGlobal('window', { location: { origin }, innerWidth: 1200 })
})
afterAll(async () => {
  vi.unstubAllGlobals()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('MiniMax selection through the real OpenCode SDK HTTP boundary', () => {
  it('uses Flash defaults and preserves explicit legacy variants, image prompts and stored history', async () => {
    const catalog = await getProviders(directory)
    for (const [providerID, legacy, m3, flash] of routes) {
      expect(catalog.providers.find((provider) => provider.id === providerID)?.models.map((model) => model.id)).toEqual([flash, m3])
      const available = catalog.models.filter((model) => model.providerID === providerID)
      const choice = selectInteractiveModel({ models: available })!
      expect(choice.modelID).toBe(flash)
      expect(selectEffectiveModelRef({ models: available })?.id).toBe(flash)
      await createSession({ directory, model: `${choice.providerID}/${choice.modelID}` })
      expect(requests.at(-1)?.body).toEqual({ location: { directory }, model: { providerID, id: flash } })
      for (const id of [m3, legacy]) {
        const explicit = { providerID, id, variant: 'high' }
        expect(selectEffectiveModelRef({ models: available, candidates: [explicit] })).toEqual(explicit)
        await switchSessionModel('test', explicit)
        expect(requests.at(-1)?.body).toEqual({ model: explicit })
        expect((await getSession('test')).model).toEqual(explicit)
      }
      const files = [{ uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN2kAAAAASUVORK5CYII=' }]
      await sendPrompt({ sessionID: 'test', text: 'inspect', files })
      expect(requests.at(-1)?.body).toMatchObject({ text: 'inspect', files })
      expect((await listSessionMessages('test')).messages).toEqual(history)
    }
    for (const request of requests.filter((request) => ['/api/config', '/api/plugin', '/api/provider', '/api/model'].includes(request.path))) {
      expect(request.query['location[directory]']).toBe(directory)
    }
  })

  it('preserves unknown/configured catalogs and exercises backend default resolution', async () => {
    const client = { api: createOpenCodeApi({ baseUrl: `${origin}/api/opencode` }), forwardRaw: async () => new Response() }
    expect((await resolveOpenCodeModel(client, directory)).id).toBe('MiniMax-M3.1-Flash')
    expect((await resolveOpenCodeModel(client, directory, { preferredModel: 'minimax/MiniMax-M2.7#high' })).id).toBe('MiniMax-M2.7')
    config = [{ type: 'document', info: { providers: { minimax: { models: { 'MiniMax-M2.7': {} } } } } }]
    expect((await getProviders(directory)).providers.find((provider) => provider.id === 'minimax')?.models).toHaveLength(3)
    expect((await resolveOpenCodeModel(client, directory)).id).toBe('MiniMax-M2.7')
    config = []
    plugins = [{ source: { type: 'sdk' }, features: {}, state: { status: 'active' } }]
    expect((await getProviders(directory)).models).toEqual(models)
    plugins = []
    failConfig = true
    expect((await getProviders(directory)).models).toEqual(models)
    failConfig = false
  })
})
