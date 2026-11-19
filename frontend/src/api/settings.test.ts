import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { FetchError } from '@opencode-manager/shared'
import { createFetchFake } from '@/test/fetchFake'
import { settingsApi } from './settings'

const installedSkill = {
  skill: {
    name: 'teach',
    description: 'Teach',
    body: '# Teach',
    scope: 'global',
    location: 'skills/teach',
  },
  overwritten: false,
}

const fileManifestSchema = z.array(
  z.object({ fieldName: z.string(), relativePath: z.string() }),
)

const githubInstallRequest = {
  sourceType: 'github',
  url: 'https://github.com/user/repo/tree/main/teach',
  scope: 'global',
} as const

describe('settingsApi', () => {
  describe('installSkillFromGithub', () => {
    it('posts JSON to skills install endpoint', async () => {
      const fetchFake = createFetchFake([
        {
          method: 'POST',
          path: '/api/settings/skills/install',
          respond: () => ({ json: { ...installedSkill, sourceType: 'github', filesInstalled: ['SKILL.md'] } }),
        },
      ])
      fetchFake.install()

      const result = await settingsApi.installSkillFromGithub(githubInstallRequest)

      expect(result.skill.name).toBe('teach')
      const installRequest = fetchFake.lastRequest('POST', '/api/settings/skills/install')
      expect(installRequest?.headers['content-type']).toBe('application/json')
      expect(installRequest?.body).toMatchObject({ sourceType: 'github', scope: 'global' })
    })

    it('surfaces 409 conflict as FetchError', async () => {
      const fetchFake = createFetchFake([
        {
          method: 'POST',
          path: '/api/settings/skills/install',
          respond: () => ({ status: 409, json: { error: 'Skill "teach" already exists in global scope' } }),
        },
      ])
      fetchFake.install()

      const request = settingsApi.installSkillFromGithub(githubInstallRequest)

      await expect(request).rejects.toBeInstanceOf(FetchError)
      await expect(request).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  describe('installSkillFromUpload', () => {
    it('posts FormData manifest and files', async () => {
      const fetchFake = createFetchFake([
        {
          method: 'POST',
          path: '/api/settings/skills/install',
          respond: () => ({ json: { ...installedSkill, sourceType: 'upload', filesInstalled: ['teach/SKILL.md'] } }),
        },
      ])
      fetchFake.install()

      const file = new File(['# Teach Skill'], 'SKILL.md', { type: 'text/markdown' })
      Object.defineProperty(file, 'webkitRelativePath', { value: 'teach/SKILL.md' })

      const result = await settingsApi.installSkillFromUpload({ files: [file], scope: 'global' })

      expect(result.sourceType).toBe('upload')
      const formData = fetchFake.findFormData()
      if (!formData) throw new Error('no FormData request body was recorded')
      expect(formData.get('sourceType')).toBe('upload')
      expect(formData.get('file0')).toBe(file)

      const manifest = fileManifestSchema.parse(parseJsonText(z.string().parse(formData.get('fileManifest'))))
      expect(manifest).toEqual([{ fieldName: 'file0', relativePath: 'teach/SKILL.md' }])
    })
  })
})
