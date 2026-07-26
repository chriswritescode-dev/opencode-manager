import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getBrowseRootPath } from '@opencode-manager/shared/config/env'
import type { BrowseDirectoryResponse, DirectoryEntry } from '@opencode-manager/shared/types'

function getRoot(): string {
  const configured = getBrowseRootPath()
  if (!configured) {
    throw {
      message: 'Folder browsing is disabled. Set REPO_BROWSE_ROOT in the server environment to enable it.',
      statusCode: 501,
    }
  }
  return path.resolve(configured)
}

function resolveWithinRoot(root: string, requestedPath?: string): string {
  if (!requestedPath || requestedPath.trim() === '') {
    return root
  }

  const resolved = path.resolve(requestedPath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw { message: 'Path is outside the allowed browse root', statusCode: 403 }
  }

  return resolved
}

async function isGitRepo(entryPath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(path.join(entryPath, '.git'))
    return stats.isDirectory() || stats.isFile()
  } catch {
    return false
  }
}

export async function browseDirectory(requestedPath?: string): Promise<BrowseDirectoryResponse> {
  const root = getRoot()
  const targetPath = resolveWithinRoot(root, requestedPath)

  let stats
  try {
    stats = await fs.stat(targetPath)
  } catch {
    throw { message: 'Directory not found', statusCode: 404 }
  }

  if (!stats.isDirectory()) {
    throw { message: 'Path is not a directory', statusCode: 400 }
  }

  const dirEntries = await fs.readdir(targetPath, { withFileTypes: true })
  const directories = dirEntries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))

  const entries: DirectoryEntry[] = await Promise.all(
    directories.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name)
      return {
        name: entry.name,
        path: entryPath,
        isGitRepo: await isGitRepo(entryPath),
      }
    })
  )

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const isRoot = targetPath === root
  const parentPath = isRoot ? null : path.dirname(targetPath)

  return {
    path: targetPath,
    parentPath,
    isRoot,
    entries,
  }
}
