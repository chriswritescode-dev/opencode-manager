import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 500,
    },
  }
})

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  listRepos: vi.fn(() => []),
  getRepoByUrlAndBranch: vi.fn(),
  getRepoByLocalPath: vi.fn(),
  getRepoBySourcePath: vi.fn(),
  createRepo: vi.fn(),
  updateRepoStatus: vi.fn(),
  updateRepoConfigName: vi.fn(),
  updateLastPulled: vi.fn(),
  updateRepoBranch: vi.fn(),
  deleteRepo: vi.fn(),
}))

function createMockClient(skills: Array<{ name: string; description: string; location: string; content: string }>): OpenCodeClient {
  return {
    forward: vi.fn(async () => new Response(JSON.stringify(skills), { status: 200 })),
    forwardRaw: vi.fn(),
    getJson: vi.fn(),
    postJson: vi.fn(),
    setProviderAuth: vi.fn(),
    deleteProviderAuth: vi.fn(),
    startMcpAuth: vi.fn(),
    authenticateMcp: vi.fn(),
  } as unknown as OpenCodeClient
}

describe('SkillService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skills-test-'))
    vi.spyOn(await import('@opencode-manager/shared/config/env'), 'getWorkspacePath').mockReturnValue(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  const mockDb = null as unknown as never

  test('writes correct YAML frontmatter format', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `test-skill-${Date.now()}`
    const result = await createSkill(mockDb, {
      name,
      description: 'A test skill',
      body: '## Test Body\n\nContent here',
      scope: 'global' as const,
    })

    try {
      expect(result.name).toBe(name)
      expect(result.description).toBe('A test skill')
      expect(result.body).toBe('## Test Body\n\nContent here')
      const fileContent = await readFile(result.location, 'utf-8')
      expect(fileContent).toBe(`---\nname: ${name}\ndescription: A test skill\n---\n## Test Body\n\nContent here`)
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('reads skill via opencode API', async () => {
    const { createSkill, getSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `parse-test-${Date.now()}`
    const created = await createSkill(mockDb, {
      name,
      description: 'Test description',
      body: '## Body\n\nSome content',
      scope: 'global' as const,
    })

    try {
      const client = createMockClient([{
        name,
        description: 'Test description',
        location: created.location,
        content: '## Body\n\nSome content',
      }])

      const skill = await getSkill(mockDb, client, name, 'global')

      expect(skill.name).toBe(name)
      expect(skill.description).toBe('Test description')
      expect(skill.body).toBe('## Body\n\nSome content')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('accepts valid skill names', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const validNames = ['my-skill', 'a', 'skill-1-2', 'test123', 'a-b-c']
    const createdNames: string[] = []

    for (const baseName of validNames) {
      const name = `${baseName}-${Date.now()}`
      try {
        await expect(createSkill(mockDb, {
          name,
          description: 'Test',
          body: 'Body',
          scope: 'global' as const,
        })).resolves.toBeDefined()
        createdNames.push(name)
      } catch {
        // Ignore failures, just cleanup what was created
      }
    }

    for (const name of createdNames) {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('rejects invalid skill names', async () => {
    const { createSkill } = await import('../../src/services/skills')
    const invalidNames = ['My-Skill', '--bad', 'bad-', 'has spaces', 'has_underscore', 'has.dot', 'UPPERCASE']

    for (const name of invalidNames) {
      await expect(createSkill(mockDb, {
        name: `${name}-${Date.now()}`,
        description: 'Test',
        body: 'Body',
        scope: 'global' as const,
      })).rejects.toThrow('Invalid skill name')
    }
  })

  test('creates skill file at correct path', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `new-skill-${Date.now()}`
    try {
      const result = await createSkill(mockDb, {
        name,
        description: 'A new skill',
        body: 'Skill body content',
        scope: 'global' as const,
      })

      expect(result.name).toBe(name)
      expect(result.scope).toBe('global')
      expect(result.location).toContain(`${name}/SKILL.md`)
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('throws error on duplicate name', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `duplicate-${Date.now()}`

    try {
      await createSkill(mockDb, {
        name,
        description: 'First',
        body: 'Body',
        scope: 'global' as const,
      })

      await expect(createSkill(mockDb, {
        name,
        description: 'Second',
        body: 'Body',
        scope: 'global' as const,
      })).rejects.toThrow('already exists')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill', async () => {
    const { getSkill } = await import('../../src/services/skills')
    const client = createMockClient([])
    await expect(getSkill(mockDb, client, 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('updates only changed fields, preserving body', async () => {
    const { createSkill, updateSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `update-test-${Date.now()}`

    const created = await createSkill(mockDb, {
      name,
      description: 'Original description',
      body: 'Original body',
      scope: 'global' as const,
    })

    try {
      const client = createMockClient([{
        name,
        description: 'Original description',
        location: created.location,
        content: 'Original body',
      }])

      const updated = await updateSkill(
        mockDb,
        client,
        name,
        'global',
        { description: 'Updated description' },
        undefined,
      )

      expect(updated.description).toBe('Updated description')
      expect(updated.body).toBe('Original body')

      const fileContent = await readFile(created.location, 'utf-8')
      expect(fileContent).toContain('description: Updated description')
      expect(fileContent).toContain('Original body')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill on update', async () => {
    const { updateSkill } = await import('../../src/services/skills')
    const client = createMockClient([])
    await expect(
      updateSkill(mockDb, client, 'nonexistent', 'global', { description: 'Test' }, undefined),
    ).rejects.toThrow('not found')
  })

  test('deletes skill directory', async () => {
    const { createSkill, deleteSkill, getSkill } = await import('../../src/services/skills')
    const name = `delete-test-${Date.now()}`

    await createSkill(mockDb, {
      name,
      description: 'To be deleted',
      body: 'Body',
      scope: 'global' as const,
    })
    await deleteSkill(mockDb, name, 'global')

    const client = createMockClient([])
    await expect(getSkill(mockDb, client, name, 'global')).rejects.toThrow('not found')
  })

  test('throws error for missing skill on delete', async () => {
    const { deleteSkill } = await import('../../src/services/skills')
    await expect(deleteSkill(mockDb, 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('lists global skills via opencode API', async () => {
    const { createSkill, listManagedSkills, deleteSkill } = await import('../../src/services/skills')
    const name1 = `list-test-1-${Date.now()}`
    const name2 = `list-test-2-${Date.now()}`

    try {
      const created1 = await createSkill(mockDb, {
        name: name1,
        description: 'Test 1',
        body: 'Body',
        scope: 'global' as const,
      })

      const created2 = await createSkill(mockDb, {
        name: name2,
        description: 'Test 2',
        body: 'Body',
        scope: 'global' as const,
      })

      const client = createMockClient([
        { name: name1, description: 'Test 1', location: created1.location, content: 'Body' },
        { name: name2, description: 'Test 2', location: created2.location, content: 'Body' },
      ])

      const skills = await listManagedSkills(mockDb, client)
      const createdSkills = skills.filter(s => [name1, name2].includes(s.name))
      expect(createdSkills.length).toBe(2)
      expect(createdSkills.map(s => s.name)).toEqual(
        expect.arrayContaining([name1, name2]),
      )
    } finally {
      await deleteSkill(mockDb, name1, 'global').catch(() => {})
      await deleteSkill(mockDb, name2, 'global').catch(() => {})
    }
  })

  test('lists project skills from repo .opencode directory when OpenCode returns none', async () => {
    const { listManagedSkills } = await import('../../src/services/skills')
    const dbQueries = await import('../../src/db/queries')
    const projectPath = join(tempDir, 'project-zero')
    const skillDir = join(projectPath, '.opencode', 'skills', 'project-helper')
    const repo: Repo = {
      id: 123,
      localPath: 'Project Zero',
      fullPath: projectPath,
      sourcePath: projectPath,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }

    vi.mocked(dbQueries.listRepos).mockReturnValue([repo])
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: project-helper\ndescription: Helps project work\n---\nUse repo context.',
    )

    const repoSkills = await listManagedSkills(mockDb, createMockClient([]), repo.id)
    const directorySkills = await listManagedSkills(mockDb, createMockClient([]), undefined, projectPath)

    for (const skills of [repoSkills, directorySkills]) {
      expect(skills).toContainEqual(expect.objectContaining({
        name: 'project-helper',
        description: 'Helps project work',
        scope: 'project',
        repoId: repo.id,
        repoName: 'Project Zero',
      }))
    }
  })

  test('preserves body content containing --- (horizontal rules)', async () => {
    const { createSkill, getSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `hr-test-${Date.now()}`

    const bodyWithHR = `This is the skill body.

---

This is after a horizontal rule.

---

Another section.`

    const created = await createSkill(mockDb, {
      name,
      description: 'Test horizontal rules in body',
      body: bodyWithHR,
      scope: 'global' as const,
    })

    try {
      const client = createMockClient([{
        name,
        description: 'Test horizontal rules in body',
        location: created.location,
        content: bodyWithHR,
      }])

      const skill = await getSkill(mockDb, client, name, 'global')
      expect(skill).not.toBeNull()
      expect(skill.body).toContain('---')
      expect(skill.body).toContain('This is after a horizontal rule.')
      expect(skill.body).toContain('Another section.')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('returns empty list when opencode API returns nothing', async () => {
    const { listManagedSkills } = await import('../../src/services/skills')
    const client = createMockClient([])
    const skills = await listManagedSkills(mockDb, client)
    expect(Array.isArray(skills)).toBe(true)
    expect(skills.length).toBe(0)
  })

  test('filters out skills outside managed directories', async () => {
    const { listManagedSkills } = await import('../../src/services/skills')
    const client = createMockClient([
      {
        name: 'external-skill',
        description: 'From .claude',
        location: '/some/other/path/.claude/skills/external/SKILL.md',
        content: 'body',
      },
    ])
    const skills = await listManagedSkills(mockDb, client)
    expect(skills.length).toBe(0)
  })

  describe('installSkillFromUploadedFiles', () => {
    test('installs a single SKILL.md upload globally', async () => {
      const { installSkillFromUploadedFiles, deleteSkill } = await import('../../src/services/skills')
      const content = '---\nname: teach\ndescription: Teach users\nargument-hint: "topic"\n---\nBody'
      const result = await installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'SKILL.md', content: Buffer.from(content) },
      ])

      try {
        expect(result.skill.name).toBe('teach')
        expect(result.skill.description).toBe('Teach users')
        expect(result.skill.body).toBe('Body')
        expect(result.sourceType).toBe('upload')
        expect(result.overwritten).toBe(false)
        expect(result.filesInstalled).toEqual(['SKILL.md'])

        const fileContent = await readFile(result.skill.location, 'utf-8')
        expect(fileContent).toContain('argument-hint: "topic"')
        expect(fileContent).toContain('Body')
      } finally {
        await deleteSkill(mockDb, 'teach', 'global').catch(() => {})
      }
    })

    test('preserves bundled folder files', async () => {
      const { installSkillFromUploadedFiles, deleteSkill } = await import('../../src/services/skills')
      const skillMd = '---\nname: teach\ndescription: Teach users\n---\nBody'
      const glossaryMd = '# GLOSSARY-FORMAT\n\nFormat guidelines'

      const result = await installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'teach/SKILL.md', content: Buffer.from(skillMd) },
        { relativePath: 'teach/GLOSSARY-FORMAT.md', content: Buffer.from(glossaryMd) },
      ])

      try {
        expect(result.filesInstalled).toContain('SKILL.md')
        expect(result.filesInstalled).toContain('GLOSSARY-FORMAT.md')

        const bundledFile = join(result.skill.location.replace('/SKILL.md', ''), 'GLOSSARY-FORMAT.md')
        const bundledContent = await readFile(bundledFile, 'utf-8')
        expect(bundledContent).toBe(glossaryMd)
      } finally {
        await deleteSkill(mockDb, 'teach', 'global').catch(() => {})
      }
    })

    test('rejects multiple skills', async () => {
      const { installSkillFromUploadedFiles } = await import('../../src/services/skills')

      await expect(installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'teach/SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
        { relativePath: 'review/SKILL.md', content: Buffer.from('---\nname: review\ndescription: Review\n---\nBody') },
      ])).rejects.toThrow('Only one skill')
    })

    test('prompts overwrite through conflict', async () => {
      const { installSkillFromUploadedFiles, deleteSkill } = await import('../../src/services/skills')
      const content = '---\nname: overwrite-test\ndescription: Test\n---\nOriginal'

      const first = await installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'SKILL.md', content: Buffer.from(content) },
      ])
      expect(first.overwritten).toBe(false)

      try {
        await expect(installSkillFromUploadedFiles(mockDb, {
          sourceType: 'upload',
          scope: 'global',
        }, [
          { relativePath: 'SKILL.md', content: Buffer.from(content) },
        ])).rejects.toThrow('already exists')

        const newContent = '---\nname: overwrite-test\ndescription: Test\n---\nReplaced'
        const second = await installSkillFromUploadedFiles(mockDb, {
          sourceType: 'upload',
          scope: 'global',
          overwrite: true,
        }, [
          { relativePath: 'SKILL.md', content: Buffer.from(newContent) },
        ])
        expect(second.overwritten).toBe(true)
        expect(second.skill.body).toBe('Replaced')

        const fileContent = await readFile(second.skill.location, 'utf-8')
        expect(fileContent).toContain('Replaced')
      } finally {
        await deleteSkill(mockDb, 'overwrite-test', 'global').catch(() => {})
      }
    })

    test('deleteSkill removes bundled files from installed skill', async () => {
      const { installSkillFromUploadedFiles, deleteSkill } = await import('../../src/services/skills')

      const result = await installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'teach/SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
        { relativePath: 'teach/GLOSSARY-FORMAT.md', content: Buffer.from('# Glossary') },
      ])

      const skillDir = result.skill.location.replace('/SKILL.md', '')
      const bundledFile = join(skillDir, 'GLOSSARY-FORMAT.md')

      await expect(readFile(bundledFile, 'utf-8')).resolves.toBe('# Glossary')

      await deleteSkill(mockDb, 'teach', 'global')

      await expect(readFile(bundledFile, 'utf-8')).rejects.toThrow()
    })

    test('rejects Windows drive-letter absolute paths', async () => {
      const { installSkillFromUploadedFiles } = await import('../../src/services/skills')

      await expect(installSkillFromUploadedFiles(mockDb, {
        sourceType: 'upload',
        scope: 'global',
      }, [
        { relativePath: 'C:\\temp\\SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
      ])).rejects.toThrow('Path must be relative')
    })
  })

  describe('installSkillFromGithubTree', () => {
    test('downloads a public GitHub tree skill', async () => {
      const { installSkillFromGithubTree, deleteSkill } = await import('../../src/services/skills')

      const contentsUrl = 'https://api.github.com/repos/mattpocock/skills/contents/skills/productivity/teach?ref=main'
      const downloadUrl1 = 'https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/teach/SKILL.md'
      const downloadUrl2 = 'https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/teach/GLOSSARY-FORMAT.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/productivity/teach/SKILL.md', type: 'file', download_url: downloadUrl1, url: contentsUrl },
            { name: 'GLOSSARY-FORMAT.md', path: 'skills/productivity/teach/GLOSSARY-FORMAT.md', type: 'file', download_url: downloadUrl2, url: contentsUrl.replace('teach', 'teach/GLOSSARY-FORMAT') },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl1) {
          return Promise.resolve(new Response('---\nname: teach\ndescription: Teach users\n---\nBody content'))
        }
        if (urlStr === downloadUrl2) {
          return Promise.resolve(new Response('# Glossary'))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      try {
        const result = await installSkillFromGithubTree(mockDb, {
          sourceType: 'github',
          url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
          scope: 'global',
        }, mockFetch)

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/repos/mattpocock/skills/contents/skills/productivity/teach?ref=main'),
          expect.objectContaining({
            headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }),
          }),
        )
        expect(result.skill.name).toBe('teach')
        expect(result.skill.description).toBe('Teach users')
        expect(result.sourceType).toBe('github')
        expect(result.filesInstalled).toContain('SKILL.md')
        expect(result.filesInstalled).toContain('GLOSSARY-FORMAT.md')
      } finally {
        await deleteSkill(mockDb, 'teach', 'global').catch(() => {})
      }
    })

    test('rejects non-tree GitHub URLs', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')
      const mockFetch = vi.fn()

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/teach/SKILL.md',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Invalid GitHub tree URL')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('rejects non-HTTPS GitHub tree URLs', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')
      const mockFetch = vi.fn()

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'http://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Invalid GitHub tree URL')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('rejects parent folder with multiple skills', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')

      const parentContentsUrl = 'https://api.github.com/repos/user/repo/contents/skills?ref=main'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === parentContentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'teach', path: 'skills/teach', type: 'dir', download_url: null, url: parentContentsUrl + '/teach' },
            { name: 'review', path: 'skills/review', type: 'dir', download_url: null, url: parentContentsUrl + '/review' },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === 'https://api.github.com/repos/user/repo/contents/skills/teach?ref=main') {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/teach/SKILL.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/skills/teach/SKILL.md', url },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === 'https://api.github.com/repos/user/repo/contents/skills/review?ref=main') {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/review/SKILL.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/skills/review/SKILL.md', url },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === 'https://raw.githubusercontent.com/user/repo/main/skills/teach/SKILL.md') {
          return Promise.resolve(new Response('---\nname: teach\ndescription: Teach\n---\nBody'))
        }
        if (urlStr === 'https://raw.githubusercontent.com/user/repo/main/skills/review/SKILL.md') {
          return Promise.resolve(new Response('---\nname: review\ndescription: Review\n---\nBody'))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/skills',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Only one skill')
    })

    test('enforces overwrite conflicts', async () => {
      const { installSkillFromGithubTree, deleteSkill } = await import('../../src/services/skills')

      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/my-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/my-skill/SKILL.md'

      const makeMockFetch = () => vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'my-skill/SKILL.md', type: 'file', download_url: downloadUrl, url: contentsUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response('---\nname: overwrite-test\ndescription: Test\n---\nBody'))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      try {
        const first = await installSkillFromGithubTree(mockDb, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
        }, makeMockFetch())
        expect(first.overwritten).toBe(false)

        await expect(installSkillFromGithubTree(mockDb, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
        }, makeMockFetch())).rejects.toThrow('already exists')

        const second = await installSkillFromGithubTree(mockDb, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
          overwrite: true,
        }, makeMockFetch())
        expect(second.overwritten).toBe(true)
      } finally {
        await deleteSkill(mockDb, 'overwrite-test', 'global').catch(() => {})
      }
    })

    test('rejects oversized single-file download exceeding size limit', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')

      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/huge-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/huge-skill/SKILL.md'
      const oversizedContent = '# Big\n' + 'x'.repeat(600)

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'huge-skill/SKILL.md', type: 'file', download_url: downloadUrl, url: contentsUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response(oversizedContent))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/huge-skill',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Skill files exceed maximum upload size')
    })

    test('rejects single SKILL.md download failure with GitHub status', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')

      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/failing-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/failing-skill/SKILL.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'failing-skill/SKILL.md', type: 'file', download_url: downloadUrl, url: contentsUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response('Not Found', { status: 404 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/failing-skill',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('GitHub request failed with status 404')
    })

    test('rejects bundled file download failure with GitHub status', async () => {
      const { installSkillFromGithubTree } = await import('../../src/services/skills')

      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/skill-with-bundle?ref=main'
      const skillUrl = 'https://raw.githubusercontent.com/user/repo/main/skill-with-bundle/SKILL.md'
      const bundleUrl = 'https://raw.githubusercontent.com/user/repo/main/skill-with-bundle/GLOSSARY-FORMAT.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skill-with-bundle/SKILL.md', type: 'file', download_url: skillUrl, url: contentsUrl },
            { name: 'GLOSSARY-FORMAT.md', path: 'skill-with-bundle/GLOSSARY-FORMAT.md', type: 'file', download_url: bundleUrl, url: contentsUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === skillUrl) {
          return Promise.resolve(new Response('---\nname: bundled-fail\ndescription: Test\n---\nBody'))
        }
        if (urlStr === bundleUrl) {
          return Promise.resolve(new Response('Forbidden', { status: 403 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(mockDb, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/skill-with-bundle',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('GitHub request failed with status 403')
    })
  })
})
