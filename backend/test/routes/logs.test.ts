import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { ManagerLogsResponseSchema } from '@opencode-manager/shared/schemas'
import { createLogRoutes } from '../../src/routes/logs'
import { appendManagerLogEntry, resetManagerLogBuffer } from '../../src/utils/log-buffer'
import { DEFAULTS } from '@opencode-manager/shared/config'
import { readJson } from '../helpers/read-json'

const LogErrorResponseSchema = z.object({
  error: z.string(),
  details: z.array(z.object({ message: z.string() })),
})

describe('Logs Routes', () => {
  const app = createLogRoutes()

  beforeEach(() => {
    resetManagerLogBuffer()
  })

  async function getLogs(query: string) {
    const res = await app.fetch(new Request(`http://localhost/${query}`))
    return { status: res.status, body: await readJson(res, ManagerLogsResponseSchema) }
  }

  async function getLogError(query: string) {
    const res = await app.fetch(new Request(`http://localhost/${query}`))
    return { status: res.status, body: await readJson(res, LogErrorResponseSchema) }
  }

  it('returns all appended entries in chronological order with latestSeq', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'first' })
    appendManagerLogEntry({ level: 'warn', source: 'manager', message: 'second' })
    appendManagerLogEntry({ level: 'error', source: 'opencode', message: 'third' })

    const { status, body } = await getLogs('?')

    expect(status).toBe(200)
    expect(body.entries.map((entry) => entry.message)).toEqual(['first', 'second', 'third'])
    expect(body.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(body.latestSeq).toBe(3)
  })

  it('returns only entries newer than afterSeq', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'one' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'two' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'three' })

    const { body } = await getLogs('?afterSeq=2')

    expect(body.entries.map((entry) => entry.message)).toEqual(['three'])
  })

  it('filters by minimum level, excluding lower-severity entries', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'info entry' })
    appendManagerLogEntry({ level: 'warn', source: 'manager', message: 'warn entry' })

    const { body } = await getLogs('?level=warn')

    expect(body.entries.map((entry) => entry.message)).toEqual(['warn entry'])
  })

  it('filters by source, excluding other sources', async () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'manager line' })
    appendManagerLogEntry({ level: 'info', source: 'opencode', message: 'opencode line' })

    const { body } = await getLogs('?source=opencode')

    expect(body.entries.map((entry) => entry.message)).toEqual(['opencode line'])
  })

  it.each(['?level=bogus', '?afterSeq=abc'])(
    'rejects %s with 400 and a details payload',
    async (query) => {
      const { status, body } = await getLogError(query)

      expect(status).toBe(400)
      expect(body.error).toBe('Invalid request')
      expect(body.details.length).toBeGreaterThan(0)
    },
  )

  it('returns an empty page with buffer metadata when the buffer is empty', async () => {
    const { status, body } = await getLogs('?')

    expect(status).toBe(200)
    expect(body.entries).toEqual([])
    expect(body.latestSeq).toBe(0)
    expect(body.capacity).toBe(DEFAULTS.LOGS.BUFFER_CAPACITY)
  })

  it('returns the same stable instanceId across requests and buffer resets', async () => {
    const first = await getLogs('?')
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'entry' })
    const second = await getLogs('?')
    resetManagerLogBuffer()
    const third = await getLogs('?')

    expect(first.body.instanceId.length).toBeGreaterThan(0)
    expect(second.body.instanceId).toBe(first.body.instanceId)
    expect(third.body.instanceId).toBe(first.body.instanceId)
  })
})
