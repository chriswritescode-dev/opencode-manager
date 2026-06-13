import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import { settingsApi } from './settings'

describe('settingsApi', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('installSkillFromGithub', () => {
    it('posts JSON to skills install endpoint', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ skill: { name: 'teach' }, overwritten: false, sourceType: 'github', filesInstalled: ['SKILL.md'] }), { status: 200 }),
      )

      const result = await settingsApi.installSkillFromGithub({
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/teach',
        scope: 'global',
      })

      expect(result.skill.name).toBe('teach')

      const callUrl = fetchMock.mock.calls[0][0]
      expect(callUrl).toEqual(expect.stringContaining('/api/settings/skills/install'))

      const callOptions = fetchMock.mock.calls[0][1]
      expect(callOptions.method).toBe('POST')
      expect(callOptions.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(callOptions.body)
      expect(body.sourceType).toBe('github')
    })

    it('surfaces 409 conflict as FetchError', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Skill "teach" already exists in global scope' }), { status: 409 }),
      )

      await expect(
        settingsApi.installSkillFromGithub({
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/teach',
          scope: 'global',
        }),
      ).rejects.toThrow(FetchError)

      await expect(
        settingsApi.installSkillFromGithub({
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/teach',
          scope: 'global',
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  describe('installSkillFromUpload', () => {
    it('posts FormData manifest and files', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ skill: { name: 'teach' }, overwritten: false, sourceType: 'upload', filesInstalled: ['teach/SKILL.md'] }), { status: 200 }),
      )

      const file = new File(['# Teach Skill'], 'SKILL.md', { type: 'text/markdown' })
      Object.defineProperty(file, 'webkitRelativePath', { value: 'teach/SKILL.md' })

      const result = await settingsApi.installSkillFromUpload({ files: [file], scope: 'global' })

      expect(result.sourceType).toBe('upload')

      const callUrl = fetchMock.mock.calls[0][0]
      expect(callUrl).toEqual(expect.stringContaining('/api/settings/skills/install'))

      const callOptions = fetchMock.mock.calls[0][1]
      expect(callOptions.method).toBe('POST')
      expect(callOptions.headers?.hasOwnProperty).toBeFalsy()

      const formData = callOptions.body as FormData
      expect(formData.get('sourceType')).toBe('upload')
      expect(formData.get('file0')).toBe(file)

      const manifest = JSON.parse(formData.get('fileManifest') as string)
      expect(manifest).toHaveLength(1)
      expect(manifest[0].fieldName).toBe('file0')
      expect(manifest[0].relativePath).toBe('teach/SKILL.md')
    })
  })
})
