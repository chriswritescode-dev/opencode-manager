import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import { walkthroughHunksIdentity } from '@opencode-manager/shared/schemas'
import type { ChangeWalkthrough } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { saveChangeWalkthrough } from '../../src/db/change-walkthroughs'
import { ChangeWalkthroughService, computeChangesHash, computeHunkId } from '../../src/services/change-walkthroughs'
import { SettingsService } from '../../src/services/settings'
import { createChangeWalkthroughRoutes } from '../../src/routes/change-walkthroughs'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { GitService } from '../../src/services/git/GitService'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { createCommittedRepo, createGitAuthService, git, uniqueName } from '../helpers/git-fixtures'

const SESSION_ID = 'ses_walkthrough'

function change(file: string, patch: string, status: FileDiffInfo['status'] = 'modified'): FileDiffInfo {
  return { file, patch, additions: 1, deletions: 1, status }
}

const CHANGES: FileDiffInfo[] = [change('src/a.ts', '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;')]

const HUNK_ID = computeHunkId(CHANGES[0]!.file, CHANGES[0]!.status, CHANGES[0]!.patch)

const MODEL_REPLY = JSON.stringify({
  summary: 'A summary',
  stops: [{ title: 'First', explanation: 'Why', hunkIds: [HUNK_ID] }],
})

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const generateCalls: string[] = []
  let generateImpl: (prompt: string) => Promise<string> = async () => MODEL_REPLY

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
          return { text: await generateImpl(input.prompt) }
        }),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return {
    client,
    generateCalls,
    setGenerateImpl: (impl: (prompt: string) => Promise<string>) => {
      generateImpl = impl
    },
  }
}

const routeRepoRoot = mkdtempSync(path.join(tmpdir(), 'walkthrough-routes-'))

afterAll(() => {
  rmSync(routeRepoRoot, { recursive: true, force: true })
})

function createRepoWithStagedChange(): string {
  const repo = path.join(routeRepoRoot, uniqueName('repo'))
  createCommittedRepo(repo)
  writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  git(['add', 'a.txt'], repo)
  git(['commit', '-m', 'add a'], repo)
  writeFileSync(path.join(repo, 'a.txt'), 'two\n')
  git(['add', 'a.txt'], repo)
  return repo
}

function replyForPrompt(prompt: string, summary = 'A summary'): string {
  const ids = [...prompt.matchAll(/^### (h_\S+) /gm)].map((match) => match[1]!)
  return JSON.stringify({ summary, stops: [{ title: 'A', explanation: 'Why', hunkIds: ids }] })
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
    const service = new ChangeWalkthroughService(
      db,
      fake.client,
      new SettingsService(db),
      createGitAuthService(),
      { fetchRemoteRef: vi.fn(async () => {}) } as unknown as GitService,
    )
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

  it('GET reads the diff of the requested source', async () => {
    const repo = createRepoWithStagedChange()
    sessions[SESSION_ID]!.info = { id: SESSION_ID, title: 'Title', location: { directory: repo } } as SessionInfo

    const sessionRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
    const sessionBody = (await sessionRes.json()) as { currentDiffHash: string | null }
    const stagedRes = await app.request(`/change-walkthroughs/${SESSION_ID}?source=staged`)
    const stagedBody = (await stagedRes.json()) as { currentDiffHash: string | null }

    expect(stagedRes.status).toBe(200)
    expect(typeof stagedBody.currentDiffHash).toBe('string')
    expect(stagedBody.currentDiffHash).not.toBe(sessionBody.currentDiffHash)
  })

  it('GET rejects an invalid source with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}?source=branch:-x`)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid walkthrough source' })
  })

  it('GET omits hunks when hunksFor matches the stored identity and returns them otherwise', async () => {
    const stored: ChangeWalkthrough = {
      sessionId: SESSION_ID,
      source: { kind: 'session' },
      diffHash: computeChangesHash(CHANGES),
      model: null,
      summary: 'A summary',
      stops: [
        { id: 's_1', title: 'First', explanation: 'Why', hunkIds: [HUNK_ID], status: 'ready', explanationKey: null },
      ],
      hunks: [
        {
          id: HUNK_ID,
          file: CHANGES[0]!.file,
          status: CHANGES[0]!.status,
          header: '@@ -1,2 +1,2 @@',
          text: CHANGES[0]!.patch,
          truncated: false,
        },
      ],
      omittedFiles: [],
      createdAt: 42,
    }
    saveChangeWalkthrough(db, stored)
    const identity = walkthroughHunksIdentity(stored)

    const fullRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
    const compactRes = await app.request(
      `/change-walkthroughs/${SESSION_ID}?hunksFor=${encodeURIComponent(identity)}`,
    )
    const mismatchRes = await app.request(`/change-walkthroughs/${SESSION_ID}?hunksFor=other`)

    const full = (await fullRes.json()) as { walkthrough: { hunks?: unknown[] } }
    const compact = (await compactRes.json()) as { walkthrough: { hunks?: unknown[] } }
    const mismatch = (await mismatchRes.json()) as { walkthrough: { hunks?: unknown[] } }

    expect(full.walkthrough.hunks).toHaveLength(1)
    expect(compact.walkthrough.hunks).toBeUndefined()
    expect(mismatch.walkthrough.hunks).toHaveLength(1)
  })

  it('POST stores the walkthrough under the requested source', async () => {
    const repo = createRepoWithStagedChange()
    sessions[SESSION_ID]!.info = { id: SESSION_ID, title: 'Title', location: { directory: repo } } as SessionInfo
    fake.setGenerateImpl(async (prompt) => replyForPrompt(prompt, 'Staged summary'))

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'staged' } }),
    })

    expect(res.status).toBe(202)

    await vi.waitFor(async () => {
      const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}?source=staged`)
      const state = (await getRes.json()) as { walkthrough: { summary: string } | null }
      expect(state.walkthrough?.summary).toBe('Staged summary')
    })
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
    fake.setGenerateImpl(async () => 'not json')

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })
    expect(res.status).toBe(202)

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

  it('DELETE stops an in-flight generation', async () => {
    fake.setGenerateImpl(() => new Promise<string>(() => {}))

    const postRes = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })
    expect(postRes.status).toBe(202)

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const getRes = await app.request(`/change-walkthroughs/${SESSION_ID}`)
    const state = (await getRes.json()) as { generating: boolean; error: unknown }
    expect(state.generating).toBe(false)
    expect(state.error).toBeNull()
  })

  it('DELETE is a no-op when nothing is generating', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
  })

  it('DELETE rejects an invalid source with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}?source=branch:-x`, { method: 'DELETE' })

    expect(res.status).toBe(400)
  })
})
