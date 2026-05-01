import os from 'os'
import path from 'path'
import type { Database } from 'bun:sqlite'
import type { SkillFileInfo, SkillScope, CreateSkillRequest, UpdateSkillRequest } from '@opencode-manager/shared'
import { SKILL_NAME_REGEX } from '@opencode-manager/shared'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { getRepoById, listRepos } from '../db/queries'
import type { Repo } from '@opencode-manager/shared/types'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent, deletePath, listDirectory } from './file-operations'
import type { OpenCodeClient } from './opencode/client'
import { logger } from '../utils/logger'

interface OpenCodeSkillInfo {
  name: string
  description: string
  location: string
  content: string
}

function getGlobalSkillsPath(): string {
  return path.join(getWorkspacePath(), '.config', 'opencode', 'skills')
}

function getOldGlobalSkillsPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'skills')
}

function getProjectSkillsPath(repo: Repo): string {
  return path.join(repo.fullPath, '.opencode', 'skills')
}

export async function migrateGlobalSkills(): Promise<void> {
  const oldSkillsPath = getOldGlobalSkillsPath()
  const newSkillsPath = getGlobalSkillsPath()

  const oldSkillsExist = await fileExists(oldSkillsPath)
  if (!oldSkillsExist) {
    logger.debug('No old global skills found to migrate')
    return
  }

  const entries = await listDirectory(oldSkillsPath)
  const skillDirs = entries.filter(entry => entry.isDirectory)

  if (skillDirs.length === 0) {
    logger.debug('No skill directories found in old location')
    return
  }

  let migratedCount = 0
  let skippedCount = 0

  for (const entry of skillDirs) {
    const oldSkillPath = path.join(entry.path, 'SKILL.md')
    const newSkillPath = path.join(newSkillsPath, entry.name, 'SKILL.md')

    const alreadyMigrated = await fileExists(newSkillPath)
    if (alreadyMigrated) {
      skippedCount++
      continue
    }

    const skillExists = await fileExists(oldSkillPath)
    if (!skillExists) {
      logger.warn(`Skill ${entry.name} has no SKILL.md file, skipping`)
      continue
    }

    try {
      const content = await readFileContent(oldSkillPath)
      await writeFileContent(newSkillPath, content)
      logger.info(`Migrated skill ${entry.name} from ${oldSkillsPath} to ${newSkillsPath}`)
      migratedCount++
    } catch (error) {
      logger.error(`Failed to migrate skill ${entry.name}:`, error)
    }
  }

  if (migratedCount > 0 || skippedCount > 0) {
    logger.info(`Skill migration complete: ${migratedCount} migrated, ${skippedCount} skipped (already existed)`)
  }
}

function validateSkillName(name: string): void {
  if (!SKILL_NAME_REGEX.test(name)) {
    throw new Error('Invalid skill name. Must be lowercase alphanumeric with hyphens only.')
  }
}

function getSkillFilePath(db: Database, scope: SkillScope, name: string, repoId?: number): string {
  validateSkillName(name)
  if (scope === 'global') {
    return path.join(getGlobalSkillsPath(), name, 'SKILL.md')
  }
  if (!repoId) {
    throw new Error('repoId is required for project-scoped skills')
  }
  const repo = getRepoById(db, repoId)
  if (!repo) {
    throw new Error(`Repository with id ${repoId} not found`)
  }
  return path.join(getProjectSkillsPath(repo), name, 'SKILL.md')
}

function buildSkillFileContent(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
}

async function fetchOpenCodeSkills(openCodeClient: OpenCodeClient, directory: string): Promise<OpenCodeSkillInfo[]> {
  try {
    const response = await openCodeClient.forward({
      method: 'GET',
      path: '/skill',
      directory,
    })
    if (!response.ok) {
      logger.warn(`Failed to fetch skills from OpenCode (${response.status})`)
      return []
    }
    return await response.json() as OpenCodeSkillInfo[]
  } catch (error) {
    logger.warn('Error fetching skills from OpenCode:', error)
    return []
  }
}

function classifySkillLocation(
  location: string,
  globalPrefix: string,
  repos: Repo[],
): { scope: SkillScope; repo?: Repo } | null {
  if (location.startsWith(globalPrefix + path.sep)) {
    return { scope: 'global' }
  }
  for (const repo of repos) {
    const projectPrefix = getProjectSkillsPath(repo)
    if (location.startsWith(projectPrefix + path.sep)) {
      return { scope: 'project', repo }
    }
  }
  return null
}

function toSkillFileInfo(
  skill: OpenCodeSkillInfo,
  classification: { scope: SkillScope; repo?: Repo },
): SkillFileInfo {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.content,
    scope: classification.scope,
    location: skill.location,
    repoId: classification.repo?.id,
    repoName: classification.repo?.localPath,
  }
}

export async function listManagedSkills(
  db: Database,
  openCodeClient: OpenCodeClient,
  repoId?: number,
): Promise<SkillFileInfo[]> {
  const globalPrefix = getGlobalSkillsPath()
  const allRepos = listRepos(db)

  const targetRepos = repoId
    ? allRepos.filter(r => r.id === repoId)
    : allRepos

  if (repoId && targetRepos.length === 0) {
    throw new Error(`Repository with id ${repoId} not found`)
  }

  const directories = targetRepos.length > 0
    ? targetRepos.map(r => r.fullPath)
    : [getWorkspacePath()]

  const seenLocations = new Set<string>()
  const result: SkillFileInfo[] = []

  for (const directory of directories) {
    const skills = await fetchOpenCodeSkills(openCodeClient, directory)
    for (const skill of skills) {
      if (seenLocations.has(skill.location)) continue
      const classification = classifySkillLocation(skill.location, globalPrefix, allRepos)
      if (!classification) continue
      seenLocations.add(skill.location)
      result.push(toSkillFileInfo(skill, classification))
    }
  }

  return result
}

export async function getSkill(
  db: Database,
  openCodeClient: OpenCodeClient,
  name: string,
  scope: SkillScope,
  repoId?: number,
): Promise<SkillFileInfo> {
  validateSkillName(name)
  const skills = await listManagedSkills(db, openCodeClient, repoId)
  const match = skills.find(s =>
    s.name === name &&
    s.scope === scope &&
    (scope === 'global' || s.repoId === repoId),
  )
  if (!match) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }
  return match
}

export async function createSkill(
  db: Database,
  input: CreateSkillRequest,
): Promise<SkillFileInfo> {
  const { name, description, body, scope, repoId } = input

  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (exists) {
    throw new Error(`Skill "${name}" already exists in ${scope} scope`)
  }

  await ensureDirectoryExists(path.dirname(skillPath))
  await writeFileContent(skillPath, buildSkillFileContent(name, description, body))
  logger.info(`Created skill "${name}" at ${skillPath}`)

  const repo = repoId ? getRepoById(db, repoId) : null

  return {
    name,
    description,
    body,
    scope,
    location: skillPath,
    repoId: scope === 'project' ? repoId : undefined,
    repoName: repo?.localPath,
  }
}

export async function updateSkill(
  db: Database,
  openCodeClient: OpenCodeClient,
  name: string,
  scope: SkillScope,
  input: UpdateSkillRequest,
  repoId?: number,
): Promise<SkillFileInfo> {
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }

  const existing = await getSkill(db, openCodeClient, name, scope, repoId)

  const description = input.description ?? existing.description
  const body = input.body ?? existing.body

  await writeFileContent(skillPath, buildSkillFileContent(name, description, body))
  logger.info(`Updated skill "${name}" at ${skillPath}`)

  return {
    name,
    description,
    body,
    scope,
    location: skillPath,
    repoId: existing.repoId,
    repoName: existing.repoName,
  }
}

export async function deleteSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  repoId?: number,
): Promise<void> {
  const skillPath = getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }

  await deletePath(path.dirname(skillPath))
  logger.info(`Deleted skill "${name}" from ${path.dirname(skillPath)}`)
}
