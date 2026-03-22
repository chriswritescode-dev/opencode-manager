import os from 'os'
import path from 'path'
import type { Database } from 'bun:sqlite'
import type { SkillFileInfo, SkillScope, CreateSkillRequest, UpdateSkillRequest } from '@opencode-manager/shared'
import { SKILL_NAME_REGEX } from '@opencode-manager/shared'
import { getRepoById, listRepos } from '../db/queries'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent, deletePath, listDirectory } from './file-operations'
import { logger } from '../utils/logger'

const GLOBAL_SKILLS_PATH = path.join(os.homedir(), '.config', 'opencode', 'skills')

interface ParsedSkillFile {
  frontmatter: {
    name: string
    description: string
    license?: string
    compatibility?: string
    metadata?: Record<string, string>
  }
  body: string
}

function parseSkillFile(content: string): ParsedSkillFile {
  const firstDelim = content.indexOf('---')
  if (firstDelim === -1) {
    throw new Error('Invalid SKILL.md format: missing frontmatter delimiters')
  }
  const afterFirst = firstDelim + 3
  const secondDelim = content.indexOf('\n---', afterFirst)
  if (secondDelim === -1) {
    throw new Error('Invalid SKILL.md format: missing closing frontmatter delimiter')
  }
  const frontmatterStr = content.substring(afterFirst, secondDelim).trim()
  const afterSecond = secondDelim + 4
  const body = content.substring(afterSecond).trim()
  
  const frontmatter: Record<string, unknown> = {}
  const lines = frontmatterStr.split('\n')
  
  let currentKey: string | null = null
  const metadataObj: Record<string, string> = {}
  
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    
    const kvMatch = trimmedLine.match(/^([^:]+):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]?.trim()
      const value = kvMatch[2]?.trim()
      
      if (key === 'metadata') {
        currentKey = 'metadata'
        continue
      }
      
      if (key && value !== undefined) {
        frontmatter[key] = value
        currentKey = null
      }
    } else if (currentKey === 'metadata' && trimmedLine) {
      const metaMatch = trimmedLine.match(/^\s*([^:]+):\s*(.*)$/)
      if (metaMatch) {
        const metaKey = metaMatch[1]?.trim()
        const metaValue = metaMatch[2]?.trim()
        if (metaKey && metaValue !== undefined) {
          metadataObj[metaKey] = metaValue
        }
      }
    }
  }
  
  if (Object.keys(metadataObj).length > 0) {
    frontmatter.metadata = metadataObj
  }
  
  return {
    frontmatter: {
      name: frontmatter.name as string || '',
      description: frontmatter.description as string || '',
      license: frontmatter.license as string | undefined,
      compatibility: frontmatter.compatibility as string | undefined,
      metadata: frontmatter.metadata as Record<string, string> | undefined,
    },
    body,
  }
}

function generateSkillFrontmatter(
  name: string,
  description: string,
  license?: string,
  compatibility?: string,
  metadata?: Record<string, string>
): string {
  let frontmatter = `name: ${name}\ndescription: ${description}`
  
  if (license) {
    frontmatter += `\nlicense: ${license}`
  }
  
  if (compatibility) {
    frontmatter += `\ncompatibility: ${compatibility}`
  }
  
  if (metadata && Object.keys(metadata).length > 0) {
    frontmatter += '\nmetadata:'
    for (const [key, value] of Object.entries(metadata)) {
      frontmatter += `\n  ${key}: ${value}`
    }
  }
  
  return frontmatter
}

function getSkillDirectoryPath(db: Database, scope: SkillScope, repoId?: number): string {
  if (scope === 'global') {
    return GLOBAL_SKILLS_PATH
  }
  
  if (!repoId) {
    throw new Error('repoId is required for project-scoped skills')
  }
  
  const repo = getRepoById(db, repoId)
  if (!repo) {
    throw new Error(`Repository with id ${repoId} not found`)
  }
  
  return path.join(repo.fullPath, '.opencode', 'skills')
}

function validateSkillName(name: string): void {
  if (!SKILL_NAME_REGEX.test(name)) {
    throw new Error('Invalid skill name. Must be lowercase alphanumeric with hyphens only.')
  }
}

function getSkillFilePath(db: Database, scope: SkillScope, name: string, repoId?: number): string {
  validateSkillName(name)
  const skillsDir = getSkillDirectoryPath(db, scope, repoId)
  return path.join(skillsDir, name, 'SKILL.md')
}

export async function listManagedSkills(db: Database, repoId?: number): Promise<SkillFileInfo[]> {
  const skills: SkillFileInfo[] = []
  
  const globalSkillsDir = GLOBAL_SKILLS_PATH
  const globalSkillsExist = await fileExists(globalSkillsDir)
  
  if (globalSkillsExist) {
    const entries = await listDirectory(globalSkillsDir)
    for (const entry of entries) {
      if (entry.isDirectory) {
        const skillPath = path.join(entry.path, 'SKILL.md')
        const skillExists = await fileExists(skillPath)
        if (skillExists) {
          const skillInfo = await readSkillFile(db, 'global', entry.name)
          if (skillInfo) {
            skills.push(skillInfo)
          }
        }
      }
    }
  }
  
  if (repoId) {
    const repo = getRepoById(db, repoId)
    if (repo) {
      const projectSkillsDir = path.join(repo.fullPath, '.opencode', 'skills')
      const projectSkillsExist = await fileExists(projectSkillsDir)
      
      if (projectSkillsExist) {
        const entries = await listDirectory(projectSkillsDir)
        for (const entry of entries) {
          if (entry.isDirectory) {
            const skillPath = path.join(entry.path, 'SKILL.md')
            const skillExists = await fileExists(skillPath)
            if (skillExists) {
              const skillInfo = await readSkillFile(db, 'project', entry.name, repoId)
              if (skillInfo) {
                skills.push(skillInfo)
              }
            }
          }
        }
      }
    }
  } else {
    const allRepos = listRepos(db)
    for (const repo of allRepos) {
      const projectSkillsDir = path.join(repo.fullPath, '.opencode', 'skills')
      const projectSkillsExist = await fileExists(projectSkillsDir)
      
      if (projectSkillsExist) {
        const entries = await listDirectory(projectSkillsDir)
        for (const entry of entries) {
          if (entry.isDirectory) {
            const skillPath = path.join(entry.path, 'SKILL.md')
            const skillExists = await fileExists(skillPath)
            if (skillExists) {
              const skillInfo = await readSkillFile(db, 'project', entry.name, repo.id)
              if (skillInfo) {
                skills.push(skillInfo)
              }
            }
          }
        }
      }
    }
  }
  
  return skills
}

export async function getSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  repoId?: number
): Promise<SkillFileInfo> {
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)
  
  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }
  
  const skillInfo = await readSkillFile(db, scope, name, repoId)
  if (!skillInfo) {
    throw new Error(`Failed to read skill "${name}"`)
  }
  
  return skillInfo
}

async function readSkillFile(
  db: Database,
  scope: SkillScope,
  name: string,
  repoId?: number
): Promise<SkillFileInfo | null> {
  try {
    const skillPath = getSkillFilePath(db, scope, name, repoId)
    const content = await readFileContent(skillPath)
    const parsed = parseSkillFile(content)
    
    const repo = repoId ? getRepoById(db, repoId) : null
    
    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      body: parsed.body,
      license: parsed.frontmatter.license,
      compatibility: parsed.frontmatter.compatibility,
      metadata: parsed.frontmatter.metadata,
      scope,
      location: skillPath,
      repoId: scope === 'project' ? repoId : undefined,
      repoName: repo?.localPath,
    }
  } catch (error) {
    logger.error(`Failed to read skill ${name}:`, error)
    return null
  }
}

export async function createSkill(
  db: Database,
  input: CreateSkillRequest
): Promise<SkillFileInfo> {
  const { name, description, body, license, compatibility, metadata, scope, repoId } = input
  
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)
  
  if (exists) {
    throw new Error(`Skill "${name}" already exists in ${scope} scope`)
  }
  
  const skillDir = path.dirname(skillPath)
  await ensureDirectoryExists(skillDir)
  
  const frontmatter = generateSkillFrontmatter(
    name,
    description,
    license,
    compatibility,
    metadata
  )
  
  const content = `---\n${frontmatter}\n---\n${body}`
  
  await writeFileContent(skillPath, content)
  logger.info(`Created skill "${name}" at ${skillPath}`)
  
  const repo = repoId ? getRepoById(db, repoId) : null
  
  return {
    name,
    description,
    body,
    license,
    compatibility,
    metadata,
    scope,
    location: skillPath,
    repoId: scope === 'project' ? repoId : undefined,
    repoName: repo?.localPath,
  }
}

export async function updateSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  input: UpdateSkillRequest,
  repoId?: number
): Promise<SkillFileInfo> {
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)
  
  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }
  
  const existingContent = await readFileContent(skillPath)
  const parsed = parseSkillFile(existingContent)
  
  const resolveField = <T>(field: T | null | undefined, existing: T | undefined): T | undefined => {
    if (field === null) return undefined
    if (field === undefined) return existing
    return field
  }

  const updatedFrontmatter = {
    name: parsed.frontmatter.name,
    description: input.description ?? parsed.frontmatter.description,
    license: resolveField(input.license, parsed.frontmatter.license),
    compatibility: resolveField(input.compatibility, parsed.frontmatter.compatibility),
    metadata: resolveField(input.metadata, parsed.frontmatter.metadata),
  }
  
  const updatedBody = input.body ?? parsed.body
  
  const frontmatter = generateSkillFrontmatter(
    updatedFrontmatter.name,
    updatedFrontmatter.description,
    updatedFrontmatter.license,
    updatedFrontmatter.compatibility,
    updatedFrontmatter.metadata
  )
  
  const content = `---\n${frontmatter}\n---\n${updatedBody}`
  
  await writeFileContent(skillPath, content)
  logger.info(`Updated skill "${name}" at ${skillPath}`)
  
  const repo = repoId ? getRepoById(db, repoId) : null
  
  return {
    name: updatedFrontmatter.name,
    description: updatedFrontmatter.description,
    body: updatedBody,
    license: updatedFrontmatter.license,
    compatibility: updatedFrontmatter.compatibility,
    metadata: updatedFrontmatter.metadata,
    scope,
    location: skillPath,
    repoId: scope === 'project' ? repoId : undefined,
    repoName: repo?.localPath,
  }
}

export async function deleteSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  repoId?: number
): Promise<void> {
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)
  
  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }
  
  const skillDir = path.dirname(skillPath)
  await deletePath(skillDir)
  logger.info(`Deleted skill "${name}" from ${skillDir}`)
}
