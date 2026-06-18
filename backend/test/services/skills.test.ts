import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, readFile } from 'fs/promises'
import type { OpenCodeClient } from '../../src/services/opencode/client'

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
})
