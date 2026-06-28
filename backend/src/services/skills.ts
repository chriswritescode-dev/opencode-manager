import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import type { Database } from 'bun:sqlite'
import type { SkillFileInfo, SkillScope, CreateSkillRequest, UpdateSkillRequest, InstallSkillUploadRequest, InstallSkillFromGithubRequest, InstallSkillResponse } from '@opencode-manager/shared'
import { SKILL_NAME_REGEX, SkillFrontmatterSchema } from '@opencode-manager/shared'
import { getWorkspacePath, FILE_LIMITS } from '@opencode-manager/shared/config/env'
import { getRepoById, getRepoName, listRepos } from '../db/queries'
import type { Repo } from '@opencode-manager/shared/types'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent, deletePath, listDirectory, normalizeUploadRelativePath, resolveWithinDirectory } from './file-operations'
import type { OpenCodeClient } from './opencode/client'
import { logger } from '../utils/logger'
import { githubFetchJson, githubFetchBinary, type GithubFetchFn } from '../utils/github'

interface OpenCodeSkillInfo {
  name: string
  description: string
  location: string
  content: string
}

interface SkillInstallFile {
  relativePath: string
  content: Buffer
}

interface PreparedSkillFiles {
  skillName: string
  description: string
  body: string
  files: SkillInstallFile[]
  filesInstalled: string[]
}

function getSkillTargetRoot(db: Database, scope: SkillScope, repoId?: number): string {
  if (scope === 'global') {
    return getGlobalSkillsPath()
  }
  if (repoId === undefined) {
    throw new Error('repoId is required for project-scoped skills')
  }
  const repo = getRepoById(db, repoId)
  if (!repo) {
    throw new Error(`Repository with id ${repoId} not found`)
  }
  return getProjectSkillsPath(repo)
}

function parseSkillMarkdown(content: string): { name: string; description: string; body: string } {
  if (!content.startsWith('---\n')) {
    throw new Error('Skill markdown must start with a frontmatter block')
  }
  const endIndex = content.indexOf('\n---\n', 4)
  if (endIndex === -1) {
    throw new Error('Skill markdown must have a closing frontmatter delimiter')
  }
  const frontmatterBlock = content.substring(4, endIndex)
  const body = content.substring(endIndex + 5)
  const lines = frontmatterBlock.split('\n')
  const frontmatter: Record<string, string> = {}
  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.substring(0, colonIndex).trim()
    let value = line.substring(colonIndex + 1).trim()
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.substring(1, value.length - 1)
    }
    frontmatter[key] = value
  }
  const parsed = SkillFrontmatterSchema.parse({
    name: frontmatter.name,
    description: frontmatter.description,
  })
  return {
    name: parsed.name,
    description: parsed.description,
    body,
  }
}

function prepareSingleSkillFiles(files: SkillInstallFile[]): PreparedSkillFiles {
  const normalized = files.map(f => ({
    ...f,
    relativePath: normalizeUploadRelativePath(f.relativePath),
  }))
  const skillMdFiles = normalized.filter(f => path.basename(f.relativePath) === 'SKILL.md')
  if (skillMdFiles.length === 0) {
    throw new Error('Skill source must contain SKILL.md')
  }
  if (skillMdFiles.length > 1) {
    throw new Error('Only one skill can be installed at a time')
  }
  const skillMd = skillMdFiles[0]!
  const skillDir = path.dirname(skillMd.relativePath)
  const { name, description, body } = parseSkillMarkdown(skillMd.content.toString('utf-8'))
  const prefix = skillDir === '.' ? '' : skillDir + '/'
  const strippedFiles = normalized
    .filter(f => f.relativePath === skillMd.relativePath || f.relativePath.startsWith(prefix))
    .map(f => ({
      ...f,
      relativePath: skillDir === '.' ? f.relativePath : f.relativePath.substring(prefix.length),
    }))
  for (const f of strippedFiles) {
    const checkPath = normalizeUploadRelativePath(f.relativePath)
    if (checkPath.startsWith('..')) {
      throw new Error(`File "${f.relativePath}" escapes the skill directory`)
    }
  }
  const filesInstalled = strippedFiles.map(f => f.relativePath)
  return {
    skillName: name,
    description,
    body,
    files: strippedFiles,
    filesInstalled,
  }
}

async function installSkillFiles(
  db: Database,
  input: InstallSkillUploadRequest | InstallSkillFromGithubRequest,
  files: SkillInstallFile[],
): Promise<InstallSkillResponse> {
  const prepared = prepareSingleSkillFiles(files)
  const targetRoot = getSkillTargetRoot(db, input.scope, input.repoId)
  const targetDir = path.join(targetRoot, prepared.skillName)
  const skillPath = path.join(targetDir, 'SKILL.md')

  const targetDirExists = await fileExists(targetDir)
  const targetSkillExists = await fileExists(skillPath)
  const existingTarget = targetDirExists || targetSkillExists

  if (existingTarget && input.overwrite !== true) {
    throw new Error(`Skill "${prepared.skillName}" already exists in ${input.scope} scope`)
  }

  await fs.mkdir(targetRoot, { recursive: true })
  const stagingDir = await fs.mkdtemp(path.join(targetRoot, `.${prepared.skillName}-install-`))

  try {
    for (const file of prepared.files) {
      const targetFilePath = resolveWithinDirectory(stagingDir, file.relativePath, 'staging directory')
      await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
      await fs.writeFile(targetFilePath, file.content)
    }

    if (existingTarget && input.overwrite === true) {
      await fs.rm(targetDir, { recursive: true, force: true })
    }

    await fs.rename(stagingDir, targetDir)

    const repo = input.repoId !== undefined ? getRepoById(db, input.repoId) : null

    return {
      skill: {
        name: prepared.skillName,
        description: prepared.description,
        body: prepared.body,
        scope: input.scope,
        location: skillPath,
        repoId: input.scope === 'project' ? input.repoId : undefined,
        repoName: repo ? getRepoName(repo) : undefined,
      },
      overwritten: Boolean(existingTarget),
      sourceType: input.sourceType,
      filesInstalled: prepared.filesInstalled,
    }
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function installSkillFromUploadedFiles(
  db: Database,
  input: InstallSkillUploadRequest,
  files: SkillInstallFile[],
): Promise<InstallSkillResponse> {
  return installSkillFiles(db, input, files)
}

interface GithubTreeSource {
  owner: string
  repo: string
  ref: string
  path: string
}

interface GithubContentEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url?: string | null
}

function parseGithubTreeUrl(url: string): GithubTreeSource {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid GitHub tree URL')
  }

  if (parsed.protocol !== 'https:' || parsed.host !== 'github.com') {
    throw new Error('Invalid GitHub tree URL: only https://github.com is supported')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 4 || segments[2] !== 'tree') {
    throw new Error('Invalid GitHub tree URL: must be a tree URL (github.com/owner/repo/tree/ref/path)')
  }

  const owner = segments[0]!
  const repo = segments[1]!
  const ref = segments[3]!
  const path = segments.slice(4).join('/')

  if (!path) {
    throw new Error('Invalid GitHub tree URL: path is required')
  }

  return { owner, repo, ref, path }
}

function githubContentsApiUrl(source: GithubTreeSource, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${encodedPath}?ref=${encodeURIComponent(source.ref)}`
}

async function fetchGithubSkillFiles(
  source: GithubTreeSource,
  fetchFn: GithubFetchFn = fetch,
): Promise<SkillInstallFile[]> {
  const apiUrl = githubContentsApiUrl(source, source.path)
  const data = await githubFetchJson(apiUrl, {}, fetchFn)

  if (!Array.isArray(data)) {
    const entry = data as GithubContentEntry
    if (entry.name !== 'SKILL.md') {
      throw new Error('GitHub tree URL must point to a skill folder containing SKILL.md')
    }
    const buffer = await githubFetchBinary(entry.download_url!, {}, fetchFn)
    const content = Buffer.from(buffer)
    if (content.length > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
      throw new Error('Skill files exceed maximum upload size')
    }
    return [{ relativePath: 'SKILL.md', content }]
  }

  const MAX_FILES = 100

  async function collectFileEntries(entries: GithubContentEntry[]): Promise<GithubContentEntry[]> {
    const fileEntries = entries.filter((entry) => entry.type === 'file' && entry.download_url)
    const dirEntries = entries.filter((entry) => entry.type === 'dir')
    const nested = await Promise.all(
      dirEntries.map(async (dir) => {
        const dirData = await githubFetchJson(githubContentsApiUrl(source, dir.path), {}, fetchFn)
        return Array.isArray(dirData) ? collectFileEntries(dirData as GithubContentEntry[]) : []
      }),
    )
    return [...fileEntries, ...nested.flat()]
  }

  const collected = await collectFileEntries(data as GithubContentEntry[])

  if (collected.length > MAX_FILES) {
    throw new Error(`Skill contains too many files (max ${MAX_FILES})`)
  }

  const files = await Promise.all(
    collected.map(async (entry) => {
      const relativePath = entry.path.startsWith(source.path + '/')
        ? entry.path.substring(source.path.length + 1)
        : entry.path
      const arrayBuffer = await githubFetchBinary(entry.download_url!, {}, fetchFn)
      return { relativePath, content: Buffer.from(arrayBuffer) }
    }),
  )

  const totalBytes = files.reduce((sum, file) => sum + file.content.length, 0)
  if (totalBytes > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('Skill files exceed maximum upload size')
  }

  if (files.length === 0) {
    throw new Error('GitHub tree URL contains no downloadable files')
  }

  return files
}

export async function installSkillFromGithubTree(
  db: Database,
  input: InstallSkillFromGithubRequest,
  fetchFn: GithubFetchFn = fetch,
): Promise<InstallSkillResponse> {
  const source = parseGithubTreeUrl(input.url)
  const files = await fetchGithubSkillFiles(source, fetchFn)
  return installSkillFiles(db, input, files)
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
  const targetRoot = getSkillTargetRoot(db, scope, repoId)
  return path.join(targetRoot, name, 'SKILL.md')
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
  customDirectory?: string,
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
  if (customDirectory) {
    const projectPrefix = path.join(customDirectory, '.opencode', 'skills')
    if (location.startsWith(projectPrefix + path.sep)) {
      return { scope: 'project' }
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
    repoName: classification.repo ? getRepoName(classification.repo) : undefined,
  }
}

async function scanSkillRoot(root: string, scope: SkillScope, repo?: Repo): Promise<SkillFileInfo[]> {
  if (!await fileExists(root)) {
    return []
  }

  let entries: Awaited<ReturnType<typeof listDirectory>>
  try {
    entries = await listDirectory(root)
  } catch (error) {
    logger.warn(`Failed to scan skills at ${root}:`, error)
    return []
  }

  const scanned = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory)
      .map(async (entry): Promise<SkillFileInfo | null> => {
        const skillPath = path.join(entry.path, 'SKILL.md')
        if (!await fileExists(skillPath)) return null

        try {
          const content = await readFileContent(skillPath)
          const parsed = parseSkillMarkdown(content)
          return {
            name: parsed.name,
            description: parsed.description,
            body: parsed.body,
            scope,
            location: skillPath,
            repoId: scope === 'project' ? repo?.id : undefined,
            repoName: scope === 'project' && repo ? getRepoName(repo) : undefined,
          }
        } catch (error) {
          logger.warn(`Failed to read skill at ${skillPath}:`, error)
          return null
        }
      }),
  )

  return scanned.filter((skill): skill is SkillFileInfo => skill !== null)
}

function addSkill(result: SkillFileInfo[], seenLocations: Set<string>, skill: SkillFileInfo): void {
  if (seenLocations.has(skill.location)) return
  seenLocations.add(skill.location)
  result.push(skill)
}

export async function listManagedSkills(
  db: Database,
  openCodeClient: OpenCodeClient,
  repoId?: number,
  directory?: string,
): Promise<SkillFileInfo[]> {
  const globalPrefix = getGlobalSkillsPath()
  const allRepos = listRepos(db)

  const seenLocations = new Set<string>()
  const result: SkillFileInfo[] = []

  if (directory) {
    const skills = await fetchOpenCodeSkills(openCodeClient, directory)
    for (const skill of skills) {
      if (seenLocations.has(skill.location)) continue
      const classification = classifySkillLocation(skill.location, globalPrefix, allRepos, directory)
      if (!classification) continue
      addSkill(result, seenLocations, toSkillFileInfo(skill, classification))
    }

    const repo = allRepos.find(r => r.fullPath === directory)
    const fallbackSkills = (await Promise.all([
      scanSkillRoot(globalPrefix, 'global'),
      scanSkillRoot(path.join(directory, '.opencode', 'skills'), 'project', repo),
    ])).flat()
    for (const skill of fallbackSkills) {
      addSkill(result, seenLocations, skill)
    }
  } else {
    const targetRepos = repoId
      ? allRepos.filter(r => r.id === repoId)
      : allRepos

    if (repoId && targetRepos.length === 0) {
      throw new Error(`Repository with id ${repoId} not found`)
    }

    const directories = targetRepos.length > 0
      ? targetRepos.map(r => r.fullPath)
      : [getWorkspacePath()]

    for (const dir of directories) {
      const skills = await fetchOpenCodeSkills(openCodeClient, dir)
      for (const skill of skills) {
        if (seenLocations.has(skill.location)) continue
        const classification = classifySkillLocation(skill.location, globalPrefix, allRepos)
        if (!classification) continue
        addSkill(result, seenLocations, toSkillFileInfo(skill, classification))
      }
    }

    const [globalFallback, repoFallbacks] = await Promise.all([
      scanSkillRoot(globalPrefix, 'global'),
      Promise.all(targetRepos.map(repo => scanSkillRoot(getProjectSkillsPath(repo), 'project', repo))),
    ])
    const fallbackSkills = [...globalFallback, ...repoFallbacks.flat()]
    for (const skill of fallbackSkills) {
      addSkill(result, seenLocations, skill)
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
    repoName: repo ? getRepoName(repo) : undefined,
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
