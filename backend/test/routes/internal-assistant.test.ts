import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { OPENCODE_CONFIG_SEED, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTempAssistantWorkspace } from '../helpers/assistant-workspace'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const ReloadResponseSchema = z.object({ success: z.literal(true) })
const ErrorResponseSchema = z.object({ error: z.string() })
const ValidationErrorSchema = z.object({
  error: z.string(),
  validationIssues: z.array(z.object({ path: z.string(), message: z.string() })),
})

describe('internal/assistant routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let app: Hono
  let token: string
  let workspace: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let reload: ReturnType<typeof vi.fn<OpenCodeApi['location']['reload']>>

  function reloadRequest() {
    return app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  beforeEach(async () => {
    workspace = await createTempAssistantWorkspace()
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    db = createTestDatabase()
    token = getOrCreateInternalToken(db)
    reload = vi.fn<OpenCodeApi['location']['reload']>(async () => undefined)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, {
      openCodeClient: createStubOpenCodeClient({ api: { location: { reload } } }),
    }))
  })

  afterEach(async () => {
    db.close()
    await workspace.cleanup()
  })

  it('POST /api/internal/assistant/reload returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/assistant/reload', { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it('POST /api/internal/assistant/reload returns 200 with a valid token', async () => {
    const res = await reloadRequest()
    const body = await readJson(res, ReloadResponseSchema)

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('reloads OpenCode through the shared location reload without a directory argument', async () => {
    await reloadRequest()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledWith()
  })

  it('rate-limits the endpoint at five calls per minute with a Retry-After header', async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await reloadRequest()
      statuses.push(res.status)
      if (attempt === 5) {
        expect(res.headers.get('Retry-After')).toBeTruthy()
      }
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })

  it('returns 502 when the location reload fails', async () => {
    reload.mockRejectedValue(new Error('reload failed'))

    const res = await reloadRequest()
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(502)
    expect(body.error).toBe('Failed to reload assistant workspace')
  })

  it('returns 400 without reloading when the OpenCode config is invalid', async () => {
    await writeFile(
      path.join(workspace.workspacePath, '.config/opencode/opencode.jsonc'),
      '{"model": 5}',
      'utf8',
    )

    const res = await reloadRequest()
    const body = await readJson(res, ValidationErrorSchema)

    expect(res.status).toBe(400)
    expect(body.error).toBe('OpenCode global configuration is invalid')
    expect(body.validationIssues.map((issue) => issue.path)).toEqual(['model'])
    expect(reload).not.toHaveBeenCalled()
  })
})
