import { describe, it, expect, beforeEach } from 'vitest'
import { createLogRoutes } from '../../src/routes/logs'
import { appendManagerLogEntry, resetManagerLogBuffer } from '../../src/utils/log-buffer'
import { DEFAULTS } from '@opencode-manager/shared/config'

describe('Logs Routes', () => {
  const app = createLogRoutes()

  beforeEach(() => {
    resetManagerLogBuffer()
  })

  async function getJson(query: string) {
    const res = await app.fetch(new Request(`http://localhost/${query}`))
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }

  it('returns all appended entries in chronological order with latestSeq', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'first' })
    appendManagerLogEntry({ level: 'warn', source: 'manager', message: 'second' })
    appendManagerLogEntry({ level: 'error', source: 'opencode', message: 'third' })

    const { status, json } = await getJson('?')
    const entries = json.entries as Array<{ seq: number; message: string }>

    expect(status).toBe(200)
    expect(entries.map((entry) => entry.message)).toEqual(['first', 'second', 'third'])
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(json.latestSeq).toBe(3)
  })

  it('returns only entries newer than afterSeq', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'one' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'two' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'three' })

    const { json } = await getJson('?afterSeq=2')
    const entries = json.entries as Array<{ message: string }>

    expect(entries.map((entry) => entry.message)).toEqual(['three'])
  })

  it('filters by minimum level, excluding lower-severity entries', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'info entry' })
    appendManagerLogEntry({ level: 'warn', source: 'manager', message: 'warn entry' })

    const { json } = await getJson('?level=warn')
    const entries = json.entries as Array<{ message: string }>

    expect(entries.map((entry) => entry.message)).toEqual(['warn entry'])
  })

  it('filters by source, excluding other sources', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'manager line' })
    appendManagerLogEntry({ level: 'info', source: 'opencode', message: 'opencode line' })

    const { json } = await getJson('?source=opencode')
    const entries = json.entries as Array<{ message: string }>

    expect(entries.map((entry) => entry.message)).toEqual(['opencode line'])
  })

  it('rejects unknown levels with 400 and a details payload', async () => {
    const { status, json } = await getJson('?level=bogus')

    expect(status).toBe(400)
    expect(json.error).toBe('Invalid request')
    expect(Array.isArray(json.details)).toBe(true)
  })

  it('rejects non-numeric afterSeq with 400', async () => {
    const { status, json } = await getJson('?afterSeq=abc')

    expect(status).toBe(400)
    expect(json.error).toBe('Invalid request')
    expect(Array.isArray(json.details)).toBe(true)
  })

  it('returns an empty page with buffer metadata when the buffer is empty', async () => {
    const { status, json } = await getJson('?')

    expect(status).toBe(200)
    expect(json.entries).toEqual([])
    expect(json.latestSeq).toBe(0)
    expect(json.capacity).toBe(DEFAULTS.LOGS.BUFFER_CAPACITY)
  })

  it('returns the same stable instanceId across requests and buffer resets', async () => {
    const first = await getJson('?')
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'entry' })
    const second = await getJson('?')
    resetManagerLogBuffer()
    const third = await getJson('?')

    expect(typeof first.json.instanceId).toBe('string')
    expect((first.json.instanceId as string).length).toBeGreaterThan(0)
    expect(second.json.instanceId).toBe(first.json.instanceId)
    expect(third.json.instanceId).toBe(first.json.instanceId)
  })
})
