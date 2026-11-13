import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { getOpenCodeConfigFilePath } from '@opencode-manager/shared/config/env'
import { createSettingsRoutes } from '../../src/routes/settings'
import { GitAuthService } from '../../src/services/git-auth'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'

const InstallResponseSchema = z.object({
  skill: z.object({
    name: z.string(),
    description: z.string(),
    body: z.string(),
    scope: z.string(),
    location: z.string(),
    repoId: z.number().optional(),
    repoName: z.string().optional(),
  }),
  overwritten: z.boolean(),
  sourceType: z.enum(['github', 'upload']),
  filesInstalled: z.array(z.string()),
  restartRequired: z.boolean(),
})
const ErrorResponseSchema = z.object({ error: z.string() })
const DeleteResponseSchema = z.object({ success: z.boolean(), restartRequired: z.boolean() })

const GITHUB_TREE_URL = 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach'
const GITHUB_CONTENTS_URL = 'https://api.github.com/repos/mattpocock/skills/contents/skills/productivity/teach?ref=main'
const GITHUB_DOWNLOAD_URL = 'https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/teach/SKILL.md'
const SKILL_MARKDOWN = '---\nname: teach\ndescription: A teaching skill\n---\n## Teach\n\nContent'

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return input
}

function jsonResponse(body: JsonValue): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function stubGithubFetch(markdown: string = SKILL_MARKDOWN) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = requestUrl(input)
    if (url === GITHUB_CONTENTS_URL) {
      return jsonResponse([
        {
          name: 'SKILL.md',
          path: 'skills/productivity/teach/SKILL.md',
          type: 'file',
          download_url: GITHUB_DOWNLOAD_URL,
        },
      ])
    }
    if (url === GITHUB_DOWNLOAD_URL) {
      return new Response(markdown)
    }
    return new Response(null, { status: 404 })
  })
}

interface UploadEntry {
  fieldName: string
  relativePath: string
  content: string
}

function uploadFormData(entries: UploadEntry[], extraFields: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.append('scope', extraFields.scope ?? 'global')
  formData.append('sourceType', 'upload')
  for (const [key, value] of Object.entries(extraFields)) {
    if (key === 'scope') continue
    formData.append(key, value)
  }
  formData.append('fileManifest', JSON.stringify(entries.map(({ fieldName, relativePath }) => ({ fieldName, relativePath }))))
  for (const entry of entries) {
    formData.append(entry.fieldName, new File([entry.content], 'SKILL.md', { type: 'text/markdown' }))
  }
  return formData
}

function skillEntry(relativePath = 'teach/SKILL.md', content: string = SKILL_MARKDOWN): UploadEntry {
  return { fieldName: 'file0', relativePath, content }
}

describe('Settings routes - skills', () => {
  let workspace: TempWorkspace
  let db: Database
  let reload: ReturnType<typeof vi.fn>
  let app: ReturnType<typeof createSettingsRoutes>

  function installJson(body: Record<string, JsonValue>): Promise<Response> {
    return Promise.resolve(app.request('/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  function installUpload(formData: FormData): Promise<Response> {
    return Promise.resolve(app.request('/skills/install', { method: 'POST', body: formData }))
  }

  function globalSkillPath(name: string): string {
    return join(workspace.path, '.config', 'opencode', 'skills', name, 'SKILL.md')
  }

  beforeEach(() => {
    workspace = createTempWorkspace('settings-skills-install-test-')
    db = createTestDatabase()
    reload = vi.fn(async () => undefined)
    app = createSettingsRoutes(
      db,
      new GitAuthService(),
      createStubOpenCodeClient({ api: { location: { reload } } }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    workspace.restore()
  })

  describe('POST /skills/install', () => {
    it('installs a skill from a GitHub tree URL', async () => {
      const fetchMock = stubGithubFetch()

      const res = await installJson({ sourceType: 'github', url: GITHUB_TREE_URL, scope: 'global' })

      expect(res.status).toBe(200)
      const body = await readJson(res, InstallResponseSchema)
      expect(body).toEqual({
        skill: {
          name: 'teach',
          description: 'A teaching skill',
          body: '## Teach\n\nContent',
          scope: 'global',
          location: globalSkillPath('teach'),
        },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
        restartRequired: true,
      })
      expect(fetchMock).toHaveBeenCalledWith(GITHUB_CONTENTS_URL, expect.anything())
      await expect(readFile(globalSkillPath('teach'), 'utf-8')).resolves.toBe(SKILL_MARKDOWN)
    })

    it('requests no restart after installing when OpenCode reloads successfully', async () => {
      await mkdir(join(workspace.path, '.config', 'opencode'), { recursive: true })
      await writeFile(getOpenCodeConfigFilePath(), '{}')
      stubGithubFetch()

      const res = await installJson({ sourceType: 'github', url: GITHUB_TREE_URL, scope: 'global' })

      expect(res.status).toBe(200)
      await expect(readJson(res, InstallResponseSchema)).resolves.toMatchObject({ restartRequired: false })
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('returns 409 when the skill already exists', async () => {
      await installUpload(uploadFormData([skillEntry()]))

      const res = await installUpload(uploadFormData([skillEntry()]))

      expect(res.status).toBe(409)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
        error: 'Skill "teach" already exists in global scope',
      })
    })

    it('installs an uploaded skill from multipart form data', async () => {
      const bundled = { fieldName: 'file1', relativePath: 'teach/GLOSSARY.md', content: '# Glossary' }

      const res = await installUpload(uploadFormData([skillEntry(), bundled]))

      expect(res.status).toBe(200)
      const body = await readJson(res, InstallResponseSchema)
      expect(body.sourceType).toBe('upload')
      expect(body.skill.name).toBe('teach')
      expect(body.filesInstalled).toEqual(['SKILL.md', 'GLOSSARY.md'])
      await expect(readFile(join(workspace.path, '.config', 'opencode', 'skills', 'teach', 'GLOSSARY.md'), 'utf-8')).resolves.toBe('# Glossary')
    })

    it('rejects project scope without a repoId', async () => {
      const res = await installJson({ sourceType: 'github', url: GITHUB_TREE_URL, scope: 'project' })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'repoId is required for project scope' })
    })

    it('rejects an invalid repoId in a multipart upload', async () => {
      const res = await installUpload(uploadFormData([skillEntry()], { repoId: 'abc' }))

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Invalid repoId' })
    })

    it('rejects a manifest field that is not a file', async () => {
      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'teach/SKILL.md' }]))
      formData.append('file0', 'not-a-file')

      const res = await installUpload(formData)

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Field "file0" is not a valid file' })
    })

    it.each([
      [
        'two skills in one upload',
        [skillEntry(), { fieldName: 'file1', relativePath: 'review/SKILL.md', content: SKILL_MARKDOWN }],
        'Only one skill can be installed at a time',
      ],
      [
        'no SKILL.md',
        [{ fieldName: 'file0', relativePath: 'teach/README.md', content: '# Readme' }],
        'Skill source must contain SKILL.md',
      ],
      [
        'an unsafe relative path',
        [skillEntry('../SKILL.md')],
        'Path must not contain "..": "../SKILL.md"',
      ],
    ])('returns 400 for %s', async (_label, entries, expectedError) => {
      const res = await installUpload(uploadFormData(entries))

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: expectedError })
    })

    it('rejects an unsupported content type', async () => {
      const res = await app.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'teach',
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
        error: 'Unsupported content type. Use application/json or multipart/form-data',
      })
    })
  })

  describe('DELETE /skills/:name', () => {
    it('removes an installed skill from disk', async () => {
      await installUpload(uploadFormData([skillEntry()]))

      const res = await app.request('/skills/teach?scope=global', { method: 'DELETE' })

      expect(res.status).toBe(200)
      await expect(readJson(res, DeleteResponseSchema)).resolves.toEqual({ success: true, restartRequired: true })
      await expect(readFile(globalSkillPath('teach'), 'utf-8')).rejects.toThrow()
    })

    it('returns 404 for a skill that does not exist', async () => {
      const res = await app.request('/skills/missing?scope=global', { method: 'DELETE' })

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
        error: 'Skill "missing" not found in global scope',
      })
    })
  })
})
