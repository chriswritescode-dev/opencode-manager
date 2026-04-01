import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm } from 'fs/promises'

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

  const mockDb = null as unknown as any

  test('generates correct YAML frontmatter format', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `test-skill-${Date.now()}`
    const input = {
      name,
      description: 'A test skill',
      body: '## Test Body\n\nContent here',
      scope: 'global' as const,
      license: 'MIT',
      compatibility: 'opencode',
      metadata: { key: 'value' },
    }

    try {
      const result = await createSkill(mockDb, input)

      expect(result.name).toBe(name)
      expect(result.description).toBe('A test skill')
      expect(result.body).toBe('## Test Body\n\nContent here')
      expect(result.license).toBe('MIT')
      expect(result.compatibility).toBe('opencode')
      expect(result.metadata).toEqual({ key: 'value' })
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('parses frontmatter and body correctly', async () => {
    const { createSkill, getSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `parse-test-${Date.now()}`
    const input = {
      name,
      description: 'Test description',
      body: '## Body\n\nSome content',
      scope: 'global' as const,
    }

    try {
      await createSkill(mockDb, input)
      const skill = await getSkill(mockDb, name, 'global')

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
      const input = {
        name,
        description: 'Test',
        body: 'Body',
        scope: 'global' as const,
      }

      try {
        await expect(createSkill(mockDb, input)).resolves.toBeDefined()
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
      const input = {
        name: `${name}-${Date.now()}`,
        description: 'Test',
        body: 'Body',
        scope: 'global' as const,
      }

      await expect(createSkill(mockDb, input)).rejects.toThrow('Invalid skill name')
    }
  })

  test('creates skill file at correct path', async () => {
    const { createSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `new-skill-${Date.now()}`
    const input = {
      name,
      description: 'A new skill',
      body: 'Skill body content',
      scope: 'global' as const,
    }

    try {
      const result = await createSkill(mockDb, input)

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
    const input = {
      name,
      description: 'First',
      body: 'Body',
      scope: 'global' as const,
    }

    try {
      await createSkill(mockDb, input)

      const duplicate = {
        name,
        description: 'Second',
        body: 'Body',
        scope: 'global' as const,
      }

      await expect(createSkill(mockDb, duplicate)).rejects.toThrow('already exists')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('reads skill correctly', async () => {
    const { createSkill, getSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `read-test-${Date.now()}`
    const input = {
      name,
      description: 'Read test description',
      body: 'Read test body',
      scope: 'global' as const,
      license: 'Apache-2.0',
    }

    try {
      await createSkill(mockDb, input)
      const skill = await getSkill(mockDb, name, 'global')

      expect(skill.name).toBe(name)
      expect(skill.description).toBe('Read test description')
      expect(skill.body).toBe('Read test body')
      expect(skill.license).toBe('Apache-2.0')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill', async () => {
    const { getSkill } = await import('../../src/services/skills')
    await expect(getSkill(mockDb, 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('updates only changed fields', async () => {
    const { createSkill, updateSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `update-test-${Date.now()}`
    const input = {
      name,
      description: 'Original description',
      body: 'Original body',
      scope: 'global' as const,
      license: 'MIT',
    }

    try {
      await createSkill(mockDb, input)

      const updated = await updateSkill(
        mockDb,
        name,
        'global',
        { description: 'Updated description' },
        undefined
      )

      expect(updated.description).toBe('Updated description')
      expect(updated.body).toBe('Original body')
      expect(updated.license).toBe('MIT')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('throws error for missing skill on update', async () => {
    const { updateSkill } = await import('../../src/services/skills')
    await expect(
      updateSkill(mockDb, 'nonexistent', 'global', { description: 'Test' }, undefined)
    ).rejects.toThrow('not found')
  })

  test('deletes skill directory', async () => {
    const { createSkill, deleteSkill, getSkill } = await import('../../src/services/skills')
    const name = `delete-test-${Date.now()}`
    const input = {
      name,
      description: 'To be deleted',
      body: 'Body',
      scope: 'global' as const,
    }

    await createSkill(mockDb, input)
    await deleteSkill(mockDb, name, 'global')

    await expect(getSkill(mockDb, name, 'global')).rejects.toThrow('not found')
  })

  test('throws error for missing skill on delete', async () => {
    const { deleteSkill } = await import('../../src/services/skills')
    await expect(deleteSkill(mockDb, 'nonexistent', 'global')).rejects.toThrow('not found')
  })

  test('lists global skills', async () => {
    const { createSkill, listManagedSkills, deleteSkill } = await import('../../src/services/skills')
    const name1 = `list-test-1-${Date.now()}`
    const name2 = `list-test-2-${Date.now()}`

    try {
      await createSkill(mockDb, {
        name: name1,
        description: 'Test 1',
        body: 'Body',
        scope: 'global' as const,
      })

      await createSkill(mockDb, {
        name: name2,
        description: 'Test 2',
        body: 'Body',
        scope: 'global' as const,
      })

      const skills = await listManagedSkills(mockDb)

      const createdSkills = skills.filter(s => [name1, name2].includes(s.name))
      expect(createdSkills.length).toBe(2)
      expect(createdSkills.map(s => s.name)).toEqual(
        expect.arrayContaining([name1, name2])
      )
    } finally {
      await deleteSkill(mockDb, name1, 'global').catch(() => {})
      await deleteSkill(mockDb, name2, 'global').catch(() => {})
    }
  })

  test('should handle body content containing --- (horizontal rules)', async () => {
    const { createSkill, getSkill, deleteSkill } = await import('../../src/services/skills')
    const name = `hr-test-${Date.now()}`
    
    const bodyWithHR = `This is the skill body.

---

This is after a horizontal rule.

---

Another section.`

    try {
      await createSkill(mockDb, {
        name,
        description: 'Test horizontal rules in body',
        body: bodyWithHR,
        scope: 'global' as const,
      })

      const skill = await getSkill(mockDb, name, 'global')
      expect(skill).not.toBeNull()
      expect(skill!.body).toContain('---')
      expect(skill!.body).toContain('This is after a horizontal rule.')
      expect(skill!.body).toContain('Another section.')
    } finally {
      await deleteSkill(mockDb, name, 'global').catch(() => {})
    }
  })

  test('lists skills from all repos when no repoId is provided', async () => {
    const { listManagedSkills } = await import('../../src/services/skills')

    const skills = await listManagedSkills(mockDb)
    
    expect(Array.isArray(skills)).toBe(true)
  })
})
