import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { sseAggregator, type PendingActionsFetcher } from '../../src/services/sse-aggregator'

interface CapturedClient {
  events: Array<{ event: string; data: string }>
  frames: string[]
  callback: (event: string, data: string) => void
  writeFrame: (frame: Uint8Array) => void
}

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

function parseFrame(frame: string): { directory: string | null; serverId?: string; payload: { type: string } } {
  return JSON.parse(frame.replace(/^event: message\ndata: /, '').trim())
}

function makeFetcher(): PendingActionsFetcher {
  const api = {
    permission: {
      request: {
        list: vi.fn(async (input?: { location?: { directory?: string } }) => ({
          location: { directory: input?.location?.directory ?? '' },
          data: [{ id: 'perm-1', sessionID: 'ses-1' }],
        })),
      },
    },
    form: {
      list: vi.fn(async (input?: { location?: { directory?: string } }) => ({
        location: { directory: input?.location?.directory ?? '' },
        data: [],
      })),
    },
  } as unknown as OpenCodeApi
  return { api }
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

const PAYLOAD = '{"id":"evt_1","created":1,"type":"session.idle","location":{"directory":"/repo"},"data":{"sessionID":"ses_1"}}'

describe('SSEAggregator remote envelope delivery', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('broadcasts a located remote envelope to every connected client whatever they are subscribed to', () => {
    const subscribed = createCapturingClient()
    const otherDirectory = createCapturingClient()
    const otherServer = createCapturingClient()
    const local = createCapturingClient()
    const unsubscribed = createCapturingClient()
    sseAggregator.addClient('remote-key', subscribed.callback, subscribed.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('other-dir', otherDirectory.callback, otherDirectory.writeFrame, ['srv_a|/other'])
    sseAggregator.addClient('other-server', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    sseAggregator.addClient('local-dir', local.callback, local.writeFrame, ['/repo'])
    sseAggregator.addClient('no-directories', unsubscribed.callback, unsubscribed.writeFrame, [])

    sseAggregator.deliverRemoteEnvelope('srv_a', '/repo', PAYLOAD)

    const expected = { directory: '/repo', serverId: 'srv_a', payload: JSON.parse(PAYLOAD) }
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
    sseAggregator.addClient('any-a', first.callback, first.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('any-b', second.callback, second.writeFrame, ['srv_a|/elsewhere'])
    sseAggregator.addClient('any-c', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    sseAggregator.addClient('any-d', local.callback, local.writeFrame, ['/repo'])

    sseAggregator.deliverRemoteEnvelope('srv_a', null, PAYLOAD)

    const expected = { directory: null, serverId: 'srv_a', payload: JSON.parse(PAYLOAD) }
    expect(first.frames.map(parseFrame)).toEqual([expected])
    expect(second.frames.map(parseFrame)).toEqual([expected])
    expect(otherServer.frames.map(parseFrame)).toEqual([expected])
    expect(local.frames.map(parseFrame)).toEqual([expected])
  })

  it('skips a targeted remote envelope once the client unsubscribed', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('targeted', client.callback, client.writeFrame, ['srv_a|/repo'])
    sseAggregator.removeDirectories('targeted', ['srv_a|/repo'])

    sseAggregator.deliverRemoteEnvelopeToClient('targeted', 'srv_a', '/repo', PAYLOAD)

    expect(client.frames).toHaveLength(0)
  })

  it('delivers a targeted remote envelope to a subscribed client', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('targeted-ok', client.callback, client.writeFrame, ['srv_a|/repo'])

    sseAggregator.deliverRemoteEnvelopeToClient('targeted-ok', 'srv_a', '/repo', PAYLOAD)

    expect(client.frames.map(parseFrame)).toEqual([
      { directory: '/repo', serverId: 'srv_a', payload: JSON.parse(PAYLOAD) },
    ])
  })

  it('sends a resync only to the subscribers of that server', () => {
    const subscribed = createCapturingClient()
    const otherServer = createCapturingClient()
    const local = createCapturingClient()
    sseAggregator.addClient('resync-a', subscribed.callback, subscribed.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('resync-b', otherServer.callback, otherServer.writeFrame, ['srv_b|/repo'])
    sseAggregator.addClient('resync-c', local.callback, local.writeFrame, ['/repo'])

    sseAggregator.sendRemoteResync('srv_a')

    expect(subscribed.events).toHaveLength(1)
    expect(subscribed.events[0]!.event).toBe('resync')
    expect(JSON.parse(subscribed.events[0]!.data)).toEqual({ timestamp: expect.any(Number), serverId: 'srv_a' })
    expect(otherServer.events).toHaveLength(0)
    expect(local.events).toHaveLength(0)
    expect(subscribed.frames).toHaveLength(0)
  })

  it('keeps the local envelope free of a serverId', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('local-envelope', client.callback, client.writeFrame, ['/repo'])

    ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage(PAYLOAD)

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/repo","payload":${PAYLOAD}}\n\n`])
    expect(client.frames[0]).not.toContain('serverId')
    expect(parseFrame(client.frames[0]!).serverId).toBeUndefined()
  })

  it('routes remote subscriptions to the remote replay hook instead of the local fetcher', async () => {
    const fetcher = makeFetcher()
    sseAggregator.setPendingActionsFetcher(fetcher)
    const remoteReplay = vi.fn(async () => {})

    sseAggregator.addClient('mixed', () => {}, () => {}, ['/repo', 'srv_a|/repo'])
    sseAggregator.setRemoteReplayHandler(remoteReplay)
    sseAggregator.addDirectories('mixed', ['srv_a|/new'])

    await flushReplay()

    expect(remoteReplay).toHaveBeenCalledTimes(1)
    expect(remoteReplay).toHaveBeenCalledWith('mixed', 'srv_a', '/new')
    expect(fetcher.api.permission.request.list).toHaveBeenCalledTimes(1)
    expect(fetcher.api.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
  })

  it('does not replay remote keys through the local fetcher on connect', async () => {
    const fetcher = makeFetcher()
    sseAggregator.setPendingActionsFetcher(fetcher)
    const remoteReplay = vi.fn()
    sseAggregator.setRemoteReplayHandler(remoteReplay)

    sseAggregator.addClient('remote-only', () => {}, () => {}, ['srv_a|/repo'])
    await flushReplay()

    expect(fetcher.api.permission.request.list).not.toHaveBeenCalled()
    expect(fetcher.api.form.list).not.toHaveBeenCalled()
    expect(remoteReplay).toHaveBeenCalledWith('remote-only', 'srv_a', '/repo')
  })

  it('isolates a failing remote replay hook', async () => {
    const healthy = vi.fn()
    sseAggregator.setRemoteReplayHandler(() => { throw new Error('boom') })
    sseAggregator.addClient('failing', () => {}, () => {}, ['srv_a|/repo'])
    await flushReplay()

    sseAggregator.setRemoteReplayHandler(healthy)
    sseAggregator.addDirectories('failing', ['srv_a|/other'])
    await flushReplay()

    expect(healthy).toHaveBeenCalledWith('failing', 'srv_a', '/other')
  })

  it('stops broadcasting remote envelopes after a client is removed', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('removed', client.callback, client.writeFrame, ['srv_a|/repo'])
    sseAggregator.removeClient('removed')

    sseAggregator.deliverRemoteEnvelope('srv_a', null, PAYLOAD)

    expect(client.frames).toHaveLength(0)
  })
})
