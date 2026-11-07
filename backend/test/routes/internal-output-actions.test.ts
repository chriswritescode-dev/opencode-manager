import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { OutputService } from '../../src/services/outputs/output-service'
import { OutputError } from '../../src/services/outputs/output-error'
import { createInternalOutputActionRoutes } from '../../src/routes/internal/output-actions'

const SESSION_ID = 'ses_output_actions'

const DEFINITION = {
  id: 'note',
  label: 'Note',
  description: '',
  icon: 'FileText',
  params: [],
  instructions: 'Write a note.',
  dataSchema: { type: 'object', properties: { text: { type: 'string' } } },
  renderer: { kind: 'template', html: '<p></p>' },
  generation: 'currentSession',
}

describe('internal/output-actions routes', () => {
  let app: Hono
  let defineSessionOutput: ReturnType<typeof vi.fn>
  let readInput: ReturnType<typeof vi.fn>
  let publish: ReturnType<typeof vi.fn>

  beforeEach(() => {
    defineSessionOutput = vi.fn(() => ({ ...DEFINITION, origin: 'session' }))
    readInput = vi.fn(async () => '## Input')
    publish = vi.fn(async () => ({ outputDir: '/workspace/outputs/ses_output_actions/gen', uncoveredHunkIds: [] }))

    app = new Hono()
    app.route(
      '/output-actions',
      createInternalOutputActionRoutes({
        defineSessionOutput,
        readInput,
        publish,
      } as unknown as OutputService),
    )
  })

  function post(path: string, body?: unknown) {
    return app.request(`/output-actions/${SESSION_ID}${path}`, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  }

  it('POST /:sessionId/define stores the definition', async () => {
    const definition = { ...DEFINITION, origin: 'session' }
    defineSessionOutput.mockReturnValueOnce(definition)

    const res = await post('/define', { definition: DEFINITION })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ definition })
    expect(defineSessionOutput).toHaveBeenCalledWith(SESSION_ID, DEFINITION)
  })

  it('POST /:sessionId/define rejects a missing body', async () => {
    const res = await post('/define')

    expect(res.status).toBe(400)
    expect(defineSessionOutput).not.toHaveBeenCalled()
  })

  it('POST /:sessionId/input reads the input with an empty body', async () => {
    const res = await post('/input')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ text: '## Input' })
    expect(readInput).toHaveBeenCalledWith(SESSION_ID, undefined)
  })

  it('POST /:sessionId/input forwards the requested file', async () => {
    readInput.mockResolvedValueOnce('file input')

    const res = await post('/input', { file: 'src/a.ts' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ text: 'file input' })
    expect(readInput).toHaveBeenCalledWith(SESSION_ID, 'src/a.ts')
  })

  it('POST /:sessionId/input maps a service error', async () => {
    readInput.mockRejectedValueOnce(
      new OutputError('This session is not an output generator session', 404, { code: 'OUTPUT_NOT_A_GENERATOR_SESSION' }),
    )

    const res = await post('/input')

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      error: 'This session is not an output generator session',
      code: 'OUTPUT_NOT_A_GENERATOR_SESSION',
    })
  })

  it('POST /:sessionId/publish forwards the data body', async () => {
    const body = { definitionId: 'note', data: { text: 'Published' } }
    const result = { outputDir: '/workspace/outputs/ses_output_actions/gen', uncoveredHunkIds: ['hunk-1'] }
    publish.mockResolvedValueOnce(result)

    const res = await post('/publish', body)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(result)
    expect(publish).toHaveBeenCalledWith(SESSION_ID, body)
  })

  it('POST /:sessionId/publish rejects a body with both data and path', async () => {
    const res = await post('/publish', { data: { text: 'Published' }, path: 'out/index.html' })

    expect(res.status).toBe(400)
    expect(publish).not.toHaveBeenCalled()
  })

  it('POST /:sessionId/publish rejects a body with neither data nor path', async () => {
    const res = await post('/publish', {})

    expect(res.status).toBe(400)
    expect(publish).not.toHaveBeenCalled()
  })

  it('POST /:sessionId/publish maps a service error', async () => {
    publish.mockRejectedValueOnce(new OutputError('Unknown hunk', 400, { code: 'OUTPUT_UNKNOWN_HUNK' }))

    const res = await post('/publish', { data: { text: 'Published' } })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Unknown hunk', code: 'OUTPUT_UNKNOWN_HUNK' })
  })
})
