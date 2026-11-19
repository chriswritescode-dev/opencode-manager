import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createOpenCodeApi, type OpenCodeApi, type V2Event } from '@opencode-manager/shared/opencode'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import { createSSEAggregator, type SSEAggregator } from '../../src/services/sse-aggregator'
import type { OpenCodeClient } from '../../src/services/opencode/client'

interface CapturedClient {
  events: Array<{ event: string; data: string }>
  frames: string[]
  callback: (event: string, data: string) => void
  writeFrame: (frame: Uint8Array) => void
}

const EnvelopeSchema = z.object({
  directory: z.string().nullable(),
  serverId: z.string().optional(),
  payload: JsonValueSchema,
})

const ResyncSchema = z.object({ timestamp: z.number(), serverId: z.string() })

function createCapturingClient(): CapturedClient {
  const events: Array<{ event: string; data: string }> = []
  const frames: string[] = []
  const decoder = new TextDecoder()
  return {
    events,
    frames,
    callback: (event, data) => { events.push({ event, data }) },
    writeFrame: (frame) => { frames.push(decoder.decode(frame)) },
  }
}

function parseFrame(frame: string) {
  return EnvelopeSchema.parse(JSON.parse(frame.replace(/^event: message\ndata: /, '').trim()))
}

function sseBody(events: V2Event[]): string {
  return events.map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

function makeClient(events: V2Event[] = []): Pick<OpenCodeClient, 'api'> {
  const api = createOpenCodeApi({
    baseUrl: 'http://opencode.stub',
    fetch: Object.assign(
      async () => new Response(sseBody(events), { headers: { 'content-type': 'text/event-stream' } }),
      { preconnect: fetch.preconnect },
    ),
  })
  api.permission.request.list = vi.fn<OpenCodeApi['permission']['request']['list']>(async (input) => ({
    location: { directory: input?.location?.directory ?? '' },
    data: [{ id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: ['ls'] }],
  }))
  api.form.list = vi.fn<OpenCodeApi['form']['list']>(async (input) => ({
    location: { directory: input?.location?.directory ?? '' },
    data: [],
  }))
  return { api }
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

const LOCAL_EVENT = {
  id: 'evt_1',
  created: 1,
  type: 'session.idle',
  location: { directory: '/repo' },
  data: { sessionID: 'ses_1' },
} satisfies V2Event

describe('SSEAggregator remote envelope delivery', () => {
  let aggregator: SSEAggregator

  beforeEach(() => {
    aggregator = createSSEAggregator()
  })

  afterEach(() => {
    aggregator.shutdown()
  })

  it('broadcasts a located remote envelope to every connected client whatever they are subscribed to', () => {
    const subscribed = createCapturingClient()
    const otherDirectory = createCapturingClient()
    const otherServer = createCapturingClient()
    const local = createCapturingClient()
    const unsubscribed = createCapturingClient()
    aggregator.addClient('remote-key', subscribed.callback, subscribed.writeFrame, ['srv_a|/repo'])
    aggregator.addClient('other-dir', otherDirectory.callback, otherDirectory.writeFrame, ['srv_a|/other'])
    aggregator.addClient('other-server', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    aggregator.addClient('local-dir', local.callback, local.writeFrame, ['/repo'])
    aggregator.addClient('no-directories', unsubscribed.callback, unsubscribed.writeFrame, [])

    aggregator.deliverRemoteEnvelope('srv_a', '/repo', LOCAL_EVENT)

    const expected = { directory: '/repo', serverId: 'srv_a', payload: LOCAL_EVENT }
    expect(subscribed.frames.map(parseFrame)).toEqual([expected])
    expect(otherDirectory.frames.map(parseFrame)).toEqual([expected])
    expect(otherServer.frames.map(parseFrame)).toEqual([expected])
    expect(local.frames.map(parseFrame)).toEqual([expected])
    expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
  })

  it('broadcasts a directory-less remote envelope to every connected client', () => {
    const first = createCapturingClient()
    const second = createCapturingClient()
    const otherServer = createCapturingClient()
    const local = createCapturingClient()
    aggregator.addClient('any-a', first.callback, first.writeFrame, ['srv_a|/repo'])
    aggregator.addClient('any-b', second.callback, second.writeFrame, ['srv_a|/elsewhere'])
    aggregator.addClient('any-c', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    aggregator.addClient('any-d', local.callback, local.writeFrame, ['/repo'])

    aggregator.deliverRemoteEnvelope('srv_a', null, LOCAL_EVENT)

    const expected = { directory: null, serverId: 'srv_a', payload: LOCAL_EVENT }
    expect(first.frames.map(parseFrame)).toEqual([expected])
    expect(second.frames.map(parseFrame)).toEqual([expected])
    expect(otherServer.frames.map(parseFrame)).toEqual([expected])
    expect(local.frames.map(parseFrame)).toEqual([expected])
  })

  it('skips a targeted remote envelope once the client unsubscribed', () => {
    const client = createCapturingClient()
    aggregator.addClient('targeted', client.callback, client.writeFrame, ['srv_a|/repo'])
    aggregator.removeDirectories('targeted', ['srv_a|/repo'])

    aggregator.deliverRemoteEnvelopeToClient('targeted', 'srv_a', '/repo', LOCAL_EVENT)

    expect(client.frames).toHaveLength(0)
  })

  it('delivers a targeted remote envelope to a subscribed client', () => {
    const client = createCapturingClient()
    aggregator.addClient('targeted-ok', client.callback, client.writeFrame, ['srv_a|/repo'])

    aggregator.deliverRemoteEnvelopeToClient('targeted-ok', 'srv_a', '/repo', LOCAL_EVENT)

    expect(client.frames.map(parseFrame)).toEqual([
      { directory: '/repo', serverId: 'srv_a', payload: LOCAL_EVENT },
    ])
  })

  it('sends a resync only to the subscribers of that server', () => {
    const subscribed = createCapturingClient()
    const otherServer = createCapturingClient()
    const local = createCapturingClient()
    aggregator.addClient('resync-a', subscribed.callback, subscribed.writeFrame, ['srv_a|/repo'])
    aggregator.addClient('resync-b', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    aggregator.addClient('resync-c', local.callback, local.writeFrame, ['/repo'])

    aggregator.sendRemoteResync('srv_a')

    expect(subscribed.events).toHaveLength(1)
    expect(subscribed.events[0]!.event).toBe('resync')
    expect(ResyncSchema.parse(JSON.parse(subscribed.events[0]!.data))).toEqual({
      timestamp: expect.any(Number),
      serverId: 'srv_a',
    })
    expect(otherServer.events).toHaveLength(0)
    expect(local.events).toHaveLength(0)
    expect(subscribed.frames).toHaveLength(0)
  })

  it('keeps the local envelope free of a serverId', async () => {
    aggregator.setOpenCodeClient(makeClient([LOCAL_EVENT]))
    aggregator.start()
    const client = createCapturingClient()
    aggregator.addClient('local-envelope', client.callback, client.writeFrame, ['/repo'])

    await flushReplay()

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/repo","payload":${JSON.stringify(LOCAL_EVENT)}}\n\n`])
    expect(client.frames[0]).not.toContain('serverId')
    expect(parseFrame(client.frames[0]!).serverId).toBeUndefined()
  })

  it('routes remote subscriptions to the remote replay hook instead of the local client', async () => {
    const openCodeClient = makeClient()
    aggregator.setOpenCodeClient(openCodeClient)
    const remoteReplay = vi.fn(async () => {})

    aggregator.addClient('mixed', () => {}, () => {}, ['/repo', 'srv_a|/repo'])
    aggregator.setRemoteReplayHandler(remoteReplay)
    aggregator.addDirectories('mixed', ['srv_a|/new'])

    await flushReplay()

    expect(remoteReplay).toHaveBeenCalledTimes(1)
    expect(remoteReplay).toHaveBeenCalledWith('mixed', 'srv_a', '/new')
    expect(openCodeClient.api.permission.request.list).toHaveBeenCalledTimes(1)
    expect(openCodeClient.api.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
  })

  it('does not replay remote keys through the local client on connect', async () => {
    const openCodeClient = makeClient()
    aggregator.setOpenCodeClient(openCodeClient)
    const remoteReplay = vi.fn()
    aggregator.setRemoteReplayHandler(remoteReplay)

    aggregator.addClient('remote-only', () => {}, () => {}, ['srv_a|/repo'])
    await flushReplay()

    expect(openCodeClient.api.permission.request.list).not.toHaveBeenCalled()
    expect(openCodeClient.api.form.list).not.toHaveBeenCalled()
    expect(remoteReplay).toHaveBeenCalledWith('remote-only', 'srv_a', '/repo')
  })

  it('isolates a failing remote replay hook', async () => {
    const healthy = vi.fn()
    aggregator.setRemoteReplayHandler(() => { throw new Error('boom') })
    aggregator.addClient('failing', () => {}, () => {}, ['srv_a|/repo'])
    await flushReplay()

    aggregator.setRemoteReplayHandler(healthy)
    aggregator.addDirectories('failing', ['srv_a|/other'])
    await flushReplay()

    expect(healthy).toHaveBeenCalledWith('failing', 'srv_a', '/other')
  })

  it('stops broadcasting remote envelopes after a client is removed', () => {
    const client = createCapturingClient()
    aggregator.addClient('removed', client.callback, client.writeFrame, ['srv_a|/repo'])
    aggregator.removeClient('removed')

    aggregator.deliverRemoteEnvelope('srv_a', null, LOCAL_EVENT)

    expect(client.frames).toHaveLength(0)
  })

  it('does not serialize an envelope that no client receives', () => {
    const stringify = vi.spyOn(JSON, 'stringify')

    try {
      aggregator.deliverRemoteEnvelope('srv_a', '/repo', LOCAL_EVENT)
      aggregator.deliverRemoteEnvelopeToClient('absent', 'srv_a', '/repo', LOCAL_EVENT)

      expect(stringify).not.toHaveBeenCalledWith(LOCAL_EVENT)
    } finally {
      stringify.mockRestore()
    }
  })
})
