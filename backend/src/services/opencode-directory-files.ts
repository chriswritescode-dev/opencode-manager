import path from 'path'
import { promises as fs } from 'fs'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { normalizeUploadRelativePath, resolveWithinDirectory } from './file-operations'

export type OpenCodeDirectoryFileKind = 'agents' | 'commands'

interface UploadedOpenCodeFile {
  relativePath: string
  content: Buffer
}

export interface InstallOpenCodeDirectoryFilesResult {
  kind: OpenCodeDirectoryFileKind
  filesInstalled: string[]
}

export interface OpenCodeDirectoryFileInfo {
  kind: OpenCodeDirectoryFileKind
  name: string
  relativePath: string
}

function getOpenCodeDirectoryRoot(kind: OpenCodeDirectoryFileKind): string {
  return path.join(getWorkspacePath(), '.config', 'opencode', kind)
}

function getNameFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, '').split('/').pop() ?? relativePath
}

async function listMarkdownFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }

  const files = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(rootDir, absolutePath)
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) return []

    return [path.relative(rootDir, absolutePath).replace(/\\/g, '/')]
  }))

  return files.flat().sort((a, b) => a.localeCompare(b))
}

function getTargetRelativePath(relativePath: string, kind: OpenCodeDirectoryFileKind): string | null {
  const normalized = normalizeUploadRelativePath(relativePath, { collapseEmptySegments: true })
  if (!normalized.toLowerCase().endsWith('.md')) return null

  const parts = normalized.split('/')
  const kindIndex = parts.findIndex(part => part === kind)
  const targetParts = kindIndex >= 0 ? parts.slice(kindIndex + 1) : parts.slice(1)
  const fallbackParts = parts.length === 1 ? parts : targetParts
  const targetRelativePath = fallbackParts.join('/')

  return targetRelativePath || null
}

export async function installOpenCodeDirectoryFiles(
  kind: OpenCodeDirectoryFileKind,
  files: UploadedOpenCodeFile[],
): Promise<InstallOpenCodeDirectoryFilesResult> {
  const targetRoot = getOpenCodeDirectoryRoot(kind)
  const preparedFiles = files.flatMap(file => {
    const relativePath = getTargetRelativePath(file.relativePath, kind)
    return relativePath ? [{ relativePath, content: file.content }] : []
  })

  if (preparedFiles.length === 0) {
    throw new Error(`No markdown ${kind} files found`)
  }

  const targets = preparedFiles.map(file => ({
    relativePath: file.relativePath,
    content: file.content,
    targetFilePath: resolveWithinDirectory(targetRoot, file.relativePath, `${kind} directory`),
  }))

  await fs.mkdir(targetRoot, { recursive: true })

  await Promise.all(
    targets.map(async target => {
      await fs.mkdir(path.dirname(target.targetFilePath), { recursive: true })
      await fs.writeFile(target.targetFilePath, target.content)
    }),
  )

  return {
    kind,
    filesInstalled: preparedFiles.map(file => file.relativePath),
  }
}

export async function listOpenCodeDirectoryFiles(kind: OpenCodeDirectoryFileKind): Promise<OpenCodeDirectoryFileInfo[]> {
  const rootDir = getOpenCodeDirectoryRoot(kind)
  const files = await listMarkdownFiles(rootDir)

  return files.map(relativePath => ({
    kind,
    name: getNameFromRelativePath(relativePath),
    relativePath,
  }))
}
