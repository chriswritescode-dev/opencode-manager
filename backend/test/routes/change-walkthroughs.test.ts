import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { ChangeWalkthroughService } from '../../src/services/change-walkthroughs'
import { createChangeWalkthroughRoutes } from '../../src/routes/change-walkthroughs'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'

const SESSION_ID = 'ses_walkthrough'

function change(file: string, patch: string, status: FileDiffInfo['status'] = 'modified'): FileDiffInfo {
  return { file, patch, additions: 1, deletions: 1, status }
}

const CHANGES: FileDiffInfo[] = [change('src/a.ts', '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;')]

const MODEL_REPLY = JSON.stringify({
  summary: 'A summary',
  stops: [{ title: 'First', explanation: 'Why', hunkIds: ['f0h0'] }],
})

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const generateCalls: string[] = []
  let generateImpl: () => Promise<string> = async () => MODEL_REPLY

  const client = {
    api: {
      ...stubLoadedModelCatalog(),
      session: {
        get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (!config) {
            throw Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
          }
          if (config.info instanceof Error) {
            throw config.info
          }
          return config.info ?? ({ id: sessionID, title: `Title ${sessionID}` } as SessionInfo)
        }),
        diff: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (config?.changes instanceof Error) {
            throw config.changes
          }
          return config?.changes ?? []
        }),
      },
      message: {
        list: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          if (!sessions[sessionID]) {
            return { data: [], cursor: {} }
          }
          return { data: [{ id: 'msg-1', type: 'user', time: { created: 0 }, text: 'x' }], cursor: {} }
        }),
      },
      generate: {
        text: vi.fn(async (input: { prompt: string }) => {
          generateCalls.push(input.prompt)
          return { text: await generateImpl() }
        }),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return {
    client,
    generateCalls,
    setGenerateImpl: (impl: () => Promise<string>) => {
      generateImpl = impl
    },
  }
}

describe('change walkthrough routes', () => {
  let db: Database
  let sessions: Record<string, FakeSession>
  let fake: ReturnType<typeof createFakeClient>
  let app: Hono

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    sessions = { [SESSION_ID]: { changes: CHANGES } }
    fake = createFakeClient(sessions)
    const service = new ChangeWalkthroughService(db, fake.client)
    app = new Hono()
    app.route('/change-walkthroughs', createChangeWalkthroughRoutes(service))
  })

  afterEach(() => {
    db.close()
  })

  it('GET returns the state for a session', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      walkthrough: unknown
      currentDiffHash: string | null
      stale: boolean
      generating: boolean
      error: unknown
    }
    expect(body.walkthrough).toBeNull()
    expect(body.stale).toBe(false)
    expect(body.currentDiffHash).toEqual(expect.any(String))
    expect(body.generating).toBe(false)
    expect(body.error).toBeNull()
  })

  it('GET returns 404 for a missing session', async () => {
    const res = await app.request('/change-walkthroughs/ses_missing')

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Session not found' })
  })

  it('POST returns 202 while generating, then GET reads the walkthrough back', async () => {
    let resolveGenerate: (text: string) => void = () => {}
    fake.setGenerateImpl(() => new Promise<string>((resolve) => {
      resolveGenerate = resolve
    }))

    const postRes = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(postRes.status).toBe(202)
    const body = (await postRes.json()) as { generating: boolean; walkthrough: unknown }
    expect(body.generating).toBe(true)
    expect(body.walkthrough).toBeNull()

    resolveGenerate(MODEL_REPLY)

    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
      const state = (await getRes.json()) as { walkthrough: { summary: string } | null; generating: boolean }
      expect(state.generating).toBe(false)
      expect(state.walkthrough?.summary).toBe('A summary')
    })
  })

  it('POST accepts an empty body', async () => {
    let resolveGenerate: (text: string) => void = () => {}
    fake.setGenerateImpl(() => new Promise<string>((resolve) => {
      resolveGenerate = resolve
    }))

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(202)

    resolveGenerate(MODEL_REPLY)
    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
      const state = (await getRes.json()) as { walkthrough: unknown }
      expect(state.walkthrough).not.toBeNull()
    })
  })

  it('POST returns 200 with the stored walkthrough without a second model call', async () => {
    await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })
    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
      const state = (await getRes.json()) as { walkthrough: unknown }
      expect(state.walkthrough).not.toBeNull()
    })

    const second = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(second.status).toBe(200)
    const body = (await second.json()) as { walkthrough: { summary: string }; generating: boolean }
    expect(body.walkthrough.summary).toBe('A summary')
    expect(body.generating).toBe(false)
    expect(fake.generateCalls).toHaveLength(1)
  })

  it('POST regenerates when asked', async () => {
    await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })
    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
      const state = (await getRes.json()) as { walkthrough: unknown }
      expect(state.walkthrough).not.toBeNull()
    })

    let resolveGenerate: (text: string) => void = () => {}
    fake.setGenerateImpl(() => new Promise<string>((resolve) => {
      resolveGenerate = resolve
    }))

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: true }),
    })

    expect(res.status).toBe(202)

    resolveGenerate(MODEL_REPLY)
    await vi.waitFor(() => expect(fake.generateCalls).toHaveLength(2))
  })

  it('POST rejects an invalid body with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: 'yes' }),
    })

    expect(res.status).toBe(400)
  })

  it('POST rejects malformed JSON with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
  })

  it('POST returns 409 with a code when there are no text changes', async () => {
    sessions[SESSION_ID]!.changes = [
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
    ]

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'WALKTHROUGH_NO_TEXT_CHANGES' })
  })

  it('POST records an unparseable model reply that GET surfaces', async () => {
    let resolveGenerate: (text: string) => void = () => {}
    fake.setGenerateImpl(() => new Promise<string>((resolve) => {
      resolveGenerate = resolve
    }))

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })
    expect(res.status).toBe(202)

    resolveGenerate('not json')

    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
      const state = (await getRes.json()) as { generating: boolean; error: { code?: string } | null }
      expect(state.generating).toBe(false)
      expect(state.error?.code).toBe('WALKTHROUGH_UNPARSEABLE')
    })
  })

  it('POST returns 404 for a missing session', async () => {
    const res = await app.request('/change-walkthroughs/ses_missing', { method: 'POST' })

    expect(res.status).toBe(404)
  })
})
