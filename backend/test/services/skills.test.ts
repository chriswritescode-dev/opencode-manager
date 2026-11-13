import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, mkdtemp, rm, readFile, writeFile, symlink } from 'fs/promises'
import { promises as fs } from 'fs'
import type { SkillInfo } from '@opencode-manager/shared/opencode'
import { FILE_LIMITS } from '@opencode-manager/shared/config/env'
import {
  createSkill,
  deleteSkill,
  getSkill,
  installSkillFromGithubTree,
  installSkillFromUploadedFiles,
  listManagedSkills,
  updateSkill,
} from '../../src/services/skills'
import { listDirectory } from '../../src/services/file-operations'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { applyTestEnv } from '../helpers/test-env'

const SKILLS_DIRECTORY = '/tmp/skills-test'

function createClient(skills: SkillInfo[]) {
  return createStubOpenCodeClient({
    api: {
      skill: {
        list: vi.fn(async () => ({ location: { directory: SKILLS_DIRECTORY }, data: skills })),
      },
    },
  })
}

function skillInfo(name: string, description: string, location: string, content: string): SkillInfo {
  return { id: name, name, description, path: location, content }
}

function requestUrl(input: string | URL | Request): string {
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return input
}

describe('SkillService', () => {
  let tempDir: string
  let db: Database
  let restoreEnv: () => void

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skills-test-'))
    restoreEnv = applyTestEnv({ WORKSPACE_PATH: tempDir })
    db = createTestDatabase()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    restoreEnv()
    vi.restoreAllMocks()
    db.close()
  })

  test('writes correct YAML frontmatter format', async () => {
    const name = `test-skill-${Date.now()}`
    const result = await createSkill(db, {
      name,
      description: 'A test skill',
      body: '## Test Body\n\nContent here',
      scope: 'global',
    })

    try {
      expect(result.name).toBe(name)
      expect(result.description).toBe('A test skill')
      expect(result.body).toBe('## Test Body\n\nContent here')
      const fileContent = await readFile(result.location, 'utf-8')
      expect(fileContent).toBe(`---\nname: ${name}\ndescription: A test skill\n---\n## Test Body\n\nContent here`)
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('reads skill via opencode API', async () => {
    const name = `parse-test-${Date.now()}`
    const created = await createSkill(db, {
      name,
      description: 'Test description',
      body: '## Body\n\nSome content',
      scope: 'global',
    })

    try {
      const client = createClient([skillInfo(name, 'Test description', created.location, '## Body\n\nSome content')])

      const skill = await getSkill(db, client, name, 'global')

      expect(skill.name).toBe(name)
      expect(skill.description).toBe('Test description')
      expect(skill.body).toBe('## Body\n\nSome content')
      expect(client.api.skill.list).toHaveBeenCalledWith({ location: { directory: tempDir } })
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('accepts valid skill names', async () => {
    const validNames = ['my-skill', 'a', 'skill-1-2', 'test123', 'a-b-c']
    const createdNames: string[] = []

    for (const baseName of validNames) {
      const name = `${baseName}-${Date.now()}`
      await expect(createSkill(db, {
        name,
        description: 'Test',
        body: 'Body',
        scope: 'global',
      })).resolves.toBeDefined()
      createdNames.push(name)
    }

    for (const name of createdNames) {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('rejects invalid skill names', async () => {
    const invalidNames = ['My-Skill', '--bad', 'bad-', 'has spaces', 'has_underscore', 'has.dot', 'UPPERCASE']

    for (const name of invalidNames) {
      await expect(createSkill(db, {
        name: `${name}-${Date.now()}`,
        description: 'Test',
        body: 'Body',
        scope: 'global',
      })).rejects.toThrow('Invalid skill name')
    }
  })

  test('creates skill file at correct path', async () => {
    const name = `new-skill-${Date.now()}`
    try {
      const result = await createSkill(db, {
        name,
        description: 'A new skill',
        body: 'Skill body content',
        scope: 'global',
      })

      expect(result.name).toBe(name)
      expect(result.scope).toBe('global')
      expect(result.location).toContain(`${name}/SKILL.md`)
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('throws error on duplicate name', async () => {
    const name = `duplicate-${Date.now()}`

    try {
      await createSkill(db, {
        name,
        description: 'First',
        body: 'Body',
        scope: 'global',
      })

      await expect(createSkill(db, {
        name,
        description: 'Second',
        body: 'Body',
        scope: 'global',
      })).rejects.toThrow('already exists')
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill', async () => {
    await expect(getSkill(db, createClient([]), 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('updates only changed fields, preserving body', async () => {
    const name = `update-test-${Date.now()}`

    const created = await createSkill(db, {
      name,
      description: 'Original description',
      body: 'Original body',
      scope: 'global',
    })

    try {
      const client = createClient([skillInfo(name, 'Original description', created.location, 'Original body')])

      const updated = await updateSkill(db, client, name, 'global', { description: 'Updated description' }, undefined)

      expect(updated.description).toBe('Updated description')
      expect(updated.body).toBe('Original body')

      const fileContent = await readFile(created.location, 'utf-8')
      expect(fileContent).toContain('description: Updated description')
      expect(fileContent).toContain('Original body')
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill on update', async () => {
    await expect(
      updateSkill(db, createClient([]), 'nonexistent', 'global', { description: 'Test' }, undefined),
    ).rejects.toThrow('not found')
  })

  test('deletes skill directory', async () => {
    const name = `delete-test-${Date.now()}`

    await createSkill(db, {
      name,
      description: 'To be deleted',
      body: 'Body',
      scope: 'global',
    })
    await deleteSkill(db, name, 'global')

    await expect(getSkill(db, createClient([]), name, 'global')).rejects.toThrow('not found')
  })

  test('throws error for missing skill on delete', async () => {
    await expect(deleteSkill(db, 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('lists global skills via opencode API', async () => {
    const name1 = `list-test-1-${Date.now()}`
    const name2 = `list-test-2-${Date.now()}`

    try {
      const created1 = await createSkill(db, {
        name: name1,
        description: 'Test 1',
        body: 'Body',
        scope: 'global',
      })

      const created2 = await createSkill(db, {
        name: name2,
        description: 'Test 2',
        body: 'Body',
        scope: 'global',
      })

      const client = createClient([
        skillInfo(name1, 'Test 1', created1.location, 'Body'),
        skillInfo(name2, 'Test 2', created2.location, 'Body'),
      ])

      const skills = await listManagedSkills(db, client)
      const createdSkills = skills.filter((skill) => [name1, name2].includes(skill.name))
      expect(createdSkills.length).toBe(2)
      expect(createdSkills.map((skill) => skill.name)).toEqual(expect.arrayContaining([name1, name2]))
    } finally {
      await deleteSkill(db, name1, 'global').catch(() => {})
      await deleteSkill(db, name2, 'global').catch(() => {})
    }
  })

  test('lists project skills from repo .opencode directory when OpenCode returns none', async () => {
    const projectPath = join(tempDir, 'project-zero')
    const skillDir = join(projectPath, '.opencode', 'skills', 'project-helper')
    const repo = seedRepo(db, { localPath: 'Project Zero', sourcePath: projectPath })

    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: project-helper\ndescription: Helps project work\n---\nUse repo context.',
    )

    const client = createClient([])
    const repoSkills = await listManagedSkills(db, client, repo.id)
    const directorySkills = await listManagedSkills(db, createClient([]), undefined, projectPath)

    expect(client.api.skill.list).toHaveBeenCalledWith({ location: { directory: projectPath } })

    for (const skills of [repoSkills, directorySkills]) {
      expect(skills).toContainEqual(expect.objectContaining({
        name: 'project-helper',
        description: 'Helps project work',
        scope: 'project',
        repoId: repo.id,
        repoName: 'project-zero',
      }))
    }
  })

  test('keeps healthy skills when dangling symlinks sit beside them', async () => {
    const projectPath = join(tempDir, 'project-symlinks')
    const skillsRoot = join(projectPath, '.opencode', 'skills')

    const regularDir = join(skillsRoot, 'regular-skill')
    await mkdir(regularDir, { recursive: true })
    await writeFile(
      join(regularDir, 'SKILL.md'),
      '---\nname: regular-skill\ndescription: Regular skill\n---\nBody',
    )

    const symlinkTargetDir = join(tempDir, 'symlink-target')
    await mkdir(symlinkTargetDir, { recursive: true })
    await writeFile(
      join(symlinkTargetDir, 'SKILL.md'),
      '---\nname: linked-skill\ndescription: Linked skill\n---\nBody',
    )
    await symlink(symlinkTargetDir, join(skillsRoot, 'linked-skill'), 'dir')

    await symlink(join(tempDir, 'missing-target'), join(skillsRoot, 'dangling-skill'), 'dir')

    const plainFile = join(tempDir, 'plain-file.txt')
    await writeFile(plainFile, 'not a directory')
    await symlink(join(plainFile, 'child'), join(skillsRoot, 'notdir-skill'), 'dir')

    await symlink(join(skillsRoot, 'loop-b'), join(skillsRoot, 'loop-a'), 'dir')
    await symlink(join(skillsRoot, 'loop-a'), join(skillsRoot, 'loop-b'), 'dir')

    const skills = await listManagedSkills(db, createClient([]), undefined, projectPath)

    expect(skills).toContainEqual(expect.objectContaining({
      name: 'regular-skill',
      description: 'Regular skill',
      scope: 'project',
    }))
    expect(skills).toContainEqual(expect.objectContaining({
      name: 'linked-skill',
      description: 'Linked skill',
      scope: 'project',
    }))
    expect(skills.map((skill) => skill.name)).not.toContain('dangling-skill')
  })

  test('listDirectory rejects when the root directory is missing', async () => {
    await expect(listDirectory(join(tempDir, 'missing-root'))).rejects.toThrow('Failed to list directory')
  })

  test('listDirectory propagates unexpected stat errors', async () => {
    const dir = join(tempDir, 'stat-error-root')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'entry.txt'), 'content')

    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    )
    try {
      await expect(listDirectory(dir)).rejects.toThrow('Failed to list directory')
    } finally {
      statSpy.mockRestore()
    }
  })

  test('preserves body content containing --- (horizontal rules)', async () => {
    const name = `hr-test-${Date.now()}`

    const bodyWithHR = `This is the skill body.

---

This is after a horizontal rule.

---

Another section.`

    const created = await createSkill(db, {
      name,
      description: 'Test horizontal rules in body',
      body: bodyWithHR,
      scope: 'global',
    })

    try {
      const client = createClient([skillInfo(name, 'Test horizontal rules in body', created.location, bodyWithHR)])

      const skill = await getSkill(db, client, name, 'global')
      expect(skill).not.toBeNull()
      expect(skill.body).toContain('---')
      expect(skill.body).toContain('This is after a horizontal rule.')
      expect(skill.body).toContain('Another section.')
    } finally {
      await deleteSkill(db, name, 'global').catch(() => {})
    }
  })

  test('returns empty list when opencode API returns nothing', async () => {
    const skills = await listManagedSkills(db, createClient([]))
    expect(skills).toEqual([])
  })

  test('filters out skills outside managed directories', async () => {
    const client = createClient([
      skillInfo('external-skill', 'From .claude', '/some/other/path/.claude/skills/external/SKILL.md', 'body'),
    ])
    const skills = await listManagedSkills(db, client)
    expect(skills.length).toBe(0)
  })

  describe('installSkillFromUploadedFiles', () => {
    test('installs a single SKILL.md upload globally', async () => {
      const content = '---\nname: teach\ndescription: Teach users\nargument-hint: "topic"\n---\nBody'
      const result = await installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
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
        await deleteSkill(db, 'teach', 'global').catch(() => {})
      }
    })

    test('preserves bundled folder files', async () => {
      const skillMd = '---\nname: teach\ndescription: Teach users\n---\nBody'
      const glossaryMd = '# GLOSSARY-FORMAT\n\nFormat guidelines'

      const result = await installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
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
        await deleteSkill(db, 'teach', 'global').catch(() => {})
      }
    })

    test('rejects multiple skills', async () => {
      await expect(installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
        { relativePath: 'teach/SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
        { relativePath: 'review/SKILL.md', content: Buffer.from('---\nname: review\ndescription: Review\n---\nBody') },
      ])).rejects.toThrow('Only one skill')
    })

    test('prompts overwrite through conflict', async () => {
      const content = '---\nname: overwrite-test\ndescription: Test\n---\nOriginal'

      const first = await installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
        { relativePath: 'SKILL.md', content: Buffer.from(content) },
      ])
      expect(first.overwritten).toBe(false)

      try {
        await expect(installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
          { relativePath: 'SKILL.md', content: Buffer.from(content) },
        ])).rejects.toThrow('already exists')

        const newContent = '---\nname: overwrite-test\ndescription: Test\n---\nReplaced'
        const second = await installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global', overwrite: true }, [
          { relativePath: 'SKILL.md', content: Buffer.from(newContent) },
        ])
        expect(second.overwritten).toBe(true)
        expect(second.skill.body).toBe('Replaced')

        const fileContent = await readFile(second.skill.location, 'utf-8')
        expect(fileContent).toContain('Replaced')
      } finally {
        await deleteSkill(db, 'overwrite-test', 'global').catch(() => {})
      }
    })

    test('deleteSkill removes bundled files from installed skill', async () => {
      const result = await installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
        { relativePath: 'teach/SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
        { relativePath: 'teach/GLOSSARY-FORMAT.md', content: Buffer.from('# Glossary') },
      ])

      const skillDir = result.skill.location.replace('/SKILL.md', '')
      const bundledFile = join(skillDir, 'GLOSSARY-FORMAT.md')

      await expect(readFile(bundledFile, 'utf-8')).resolves.toBe('# Glossary')

      await deleteSkill(db, 'teach', 'global')

      await expect(readFile(bundledFile, 'utf-8')).rejects.toThrow()
    })

    test('rejects Windows drive-letter absolute paths', async () => {
      await expect(installSkillFromUploadedFiles(db, { sourceType: 'upload', scope: 'global' }, [
        { relativePath: 'C:\\temp\\SKILL.md', content: Buffer.from('---\nname: teach\ndescription: Teach\n---\nBody') },
      ])).rejects.toThrow('Path must be relative')
    })
  })

  describe('installSkillFromGithubTree', () => {
    test('downloads a public GitHub tree skill', async () => {
      const contentsUrl = 'https://api.github.com/repos/mattpocock/skills/contents/skills/productivity/teach?ref=main'
      const downloadUrl1 = 'https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/teach/SKILL.md'
      const downloadUrl2 = 'https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/teach/GLOSSARY-FORMAT.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/productivity/teach/SKILL.md', type: 'file', download_url: downloadUrl1 },
            { name: 'GLOSSARY-FORMAT.md', path: 'skills/productivity/teach/GLOSSARY-FORMAT.md', type: 'file', download_url: downloadUrl2 },
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
        const result = await installSkillFromGithubTree(db, {
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
        await deleteSkill(db, 'teach', 'global').catch(() => {})
      }
    })

    test('rejects non-tree GitHub URLs', async () => {
      const mockFetch = vi.fn()

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/teach/SKILL.md',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Invalid GitHub tree URL')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('rejects non-HTTPS GitHub tree URLs', async () => {
      const mockFetch = vi.fn()

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'http://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Invalid GitHub tree URL')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('rejects parent folder with multiple skills', async () => {
      const parentContentsUrl = 'https://api.github.com/repos/user/repo/contents/skills?ref=main'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === parentContentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'teach', path: 'skills/teach', type: 'dir', download_url: null },
            { name: 'review', path: 'skills/review', type: 'dir', download_url: null },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === 'https://api.github.com/repos/user/repo/contents/skills/teach?ref=main') {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/teach/SKILL.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/skills/teach/SKILL.md' },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === 'https://api.github.com/repos/user/repo/contents/skills/review?ref=main') {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skills/review/SKILL.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/skills/review/SKILL.md' },
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

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/skills',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Only one skill')
    })

    test('enforces overwrite conflicts', async () => {
      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/my-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/my-skill/SKILL.md'

      const makeMockFetch = () => vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'my-skill/SKILL.md', type: 'file', download_url: downloadUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response('---\nname: overwrite-test\ndescription: Test\n---\nBody'))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      try {
        const first = await installSkillFromGithubTree(db, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
        }, makeMockFetch())
        expect(first.overwritten).toBe(false)

        await expect(installSkillFromGithubTree(db, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
        }, makeMockFetch())).rejects.toThrow('already exists')

        const second = await installSkillFromGithubTree(db, {
          sourceType: 'github',
          url: 'https://github.com/user/repo/tree/main/my-skill',
          scope: 'global',
          overwrite: true,
        }, makeMockFetch())
        expect(second.overwritten).toBe(true)
      } finally {
        await deleteSkill(db, 'overwrite-test', 'global').catch(() => {})
      }
    })

    test('rejects oversized single-file download exceeding size limit', async () => {
      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/huge-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/huge-skill/SKILL.md'
      const oversizedContent = '# Big\n' + 'x'.repeat(FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES)

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'huge-skill/SKILL.md', type: 'file', download_url: downloadUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response(oversizedContent))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/huge-skill',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('Skill files exceed maximum upload size')
    })

    test('rejects single SKILL.md download failure with GitHub status', async () => {
      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/failing-skill?ref=main'
      const downloadUrl = 'https://raw.githubusercontent.com/user/repo/main/failing-skill/SKILL.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'failing-skill/SKILL.md', type: 'file', download_url: downloadUrl },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (urlStr === downloadUrl) {
          return Promise.resolve(new Response('Not Found', { status: 404 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/failing-skill',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('GitHub request failed with status 404')
    })

    test('rejects bundled file download failure with GitHub status', async () => {
      const contentsUrl = 'https://api.github.com/repos/user/repo/contents/skill-with-bundle?ref=main'
      const skillUrl = 'https://raw.githubusercontent.com/user/repo/main/skill-with-bundle/SKILL.md'
      const bundleUrl = 'https://raw.githubusercontent.com/user/repo/main/skill-with-bundle/GLOSSARY-FORMAT.md'

      const mockFetch = vi.fn((url: string | URL | Request) => {
        const urlStr = requestUrl(url)
        if (urlStr === contentsUrl) {
          return Promise.resolve(new Response(JSON.stringify([
            { name: 'SKILL.md', path: 'skill-with-bundle/SKILL.md', type: 'file', download_url: skillUrl },
            { name: 'GLOSSARY-FORMAT.md', path: 'skill-with-bundle/GLOSSARY-FORMAT.md', type: 'file', download_url: bundleUrl },
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

      await expect(installSkillFromGithubTree(db, {
        sourceType: 'github',
        url: 'https://github.com/user/repo/tree/main/skill-with-bundle',
        scope: 'global',
      }, mockFetch)).rejects.toThrow('GitHub request failed with status 403')
    })
  })
})
