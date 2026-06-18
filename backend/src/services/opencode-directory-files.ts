import path from 'path'
import { promises as fs } from 'fs'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

export type OpenCodeDirectoryFileKind = 'agents' | 'commands'

interface UploadedOpenCodeFile {
  relativePath: string
  content: Buffer
}

export interface InstallOpenCodeDirectoryFilesResult {
  kind: OpenCodeDirectoryFileKind
  filesInstalled: string[]
}

function getOpenCodeDirectoryRoot(kind: OpenCodeDirectoryFileKind): string {
  return path.join(getWorkspacePath(), '.config', 'opencode', kind)
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Path must be relative, got absolute path: "${relativePath}"`)
  }
  if (normalized === '' || normalized === '.') {
    throw new Error('Path must not be empty')
  }
  const parts = normalized.split('/').filter(Boolean)
  for (const part of parts) {
    if (part === '..') {
      throw new Error(`Path must not contain "..": "${relativePath}"`)
    }
  }
  return parts.join('/')
}

function getTargetRelativePath(relativePath: string, kind: OpenCodeDirectoryFileKind): string | null {
  const normalized = normalizeRelativePath(relativePath)
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

  await fs.mkdir(targetRoot, { recursive: true })
  const stagingDir = await fs.mkdtemp(path.join(targetRoot, '.upload-'))

  try {
    for (const file of preparedFiles) {
      const targetFilePath = path.resolve(stagingDir, file.relativePath)
      if (!targetFilePath.startsWith(stagingDir + path.sep)) {
        throw new Error(`File "${file.relativePath}" escapes the staging directory`)
      }
      await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
      await fs.writeFile(targetFilePath, file.content)
    }

    for (const file of preparedFiles) {
      const sourceFilePath = path.join(stagingDir, file.relativePath)
      const targetFilePath = path.resolve(targetRoot, file.relativePath)
      if (!targetFilePath.startsWith(targetRoot + path.sep)) {
        throw new Error(`File "${file.relativePath}" escapes the ${kind} directory`)
      }
      await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
      await fs.copyFile(sourceFilePath, targetFilePath)
    }

    return {
      kind,
      filesInstalled: preparedFiles.map(file => file.relativePath),
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
