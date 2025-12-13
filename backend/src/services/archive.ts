import archiver from 'archiver'
import { createWriteStream, createReadStream } from 'fs'
import { readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { logger } from '../utils/logger'

async function getIgnoredPaths(repoPath: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()

  try {
    const { spawn } = await import('child_process')
    
    return new Promise((resolve) => {
      const ignored = new Set<string>()
      const proc = spawn('git', ['check-ignore', '--stdin'], {
        cwd: repoPath,
        shell: false
      })

      let stdout = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stdin?.write(paths.join('\n'))
      proc.stdin?.end()

      proc.on('close', () => {
        const ignoredPaths = stdout.split('\n').filter(p => p.trim())
        for (const p of ignoredPaths) {
          ignored.add(p)
        }
        resolve(ignored)
      })

      proc.on('error', () => {
        resolve(new Set())
      })
    })
  } catch {
    return new Set()
  }
}

async function collectFiles(
  repoPath: string,
  relativePath: string = ''
): Promise<string[]> {
  const fullPath = path.join(repoPath, relativePath)
  const entries = await readdir(fullPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name
    
    if (entry.name === '.git') continue
    
    if (entry.isDirectory()) {
      files.push(entryRelPath + '/')
      const subFiles = await collectFiles(repoPath, entryRelPath)
      files.push(...subFiles)
    } else {
      files.push(entryRelPath)
    }
  }

  return files
}

async function filterIgnoredPaths(repoPath: string, allPaths: string[]): Promise<string[]> {
  const batchSize = 1000
  const ignoredSet = new Set<string>()

  for (let i = 0; i < allPaths.length; i += batchSize) {
    const batch = allPaths.slice(i, i + batchSize)
    const ignored = await getIgnoredPaths(repoPath, batch)
    for (const p of ignored) {
      ignoredSet.add(p)
      if (p.endsWith('/')) {
        ignoredSet.add(p.slice(0, -1))
      } else {
        ignoredSet.add(p + '/')
      }
    }
  }

  const filteredPaths: string[] = []
  const ignoredDirs = new Set<string>()

  for (const p of allPaths) {
    const isDir = p.endsWith('/')
    const cleanPath = isDir ? p.slice(0, -1) : p

    let isUnderIgnoredDir = false
    for (const ignoredDir of ignoredDirs) {
      if (cleanPath.startsWith(ignoredDir + '/')) {
        isUnderIgnoredDir = true
        break
      }
    }

    if (isUnderIgnoredDir) continue

    if (ignoredSet.has(p) || ignoredSet.has(cleanPath)) {
      if (isDir) {
        ignoredDirs.add(cleanPath)
      }
      continue
    }

    filteredPaths.push(p)
  }

  return filteredPaths
}

export async function createRepoArchive(repoPath: string): Promise<string> {
  const repoName = path.basename(repoPath)
  const tempFile = path.join(os.tmpdir(), `${repoName}-${Date.now()}.zip`)

  logger.info(`Creating archive for ${repoPath} at ${tempFile}`)

  const allPaths = await collectFiles(repoPath)
  const filteredPaths = await filterIgnoredPaths(repoPath, allPaths)

  const output = createWriteStream(tempFile)
  const archive = archiver('zip', { zlib: { level: 5 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      logger.info(`Archive created: ${tempFile} (${archive.pointer()} bytes)`)
      resolve(tempFile)
    })

    archive.on('error', (err) => {
      logger.error('Archive error:', err)
      reject(err)
    })

    archive.pipe(output)

    for (const relativePath of filteredPaths) {
      if (relativePath.endsWith('/')) continue

      const fullPath = path.join(repoPath, relativePath)
      const archivePath = path.join(repoName, relativePath)
      archive.file(fullPath, { name: archivePath })
    }

    archive.finalize()
  })
}

export async function deleteArchive(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
    logger.info(`Deleted temp archive: ${filePath}`)
  } catch (error) {
    logger.warn(`Failed to delete temp archive: ${filePath}`, error)
  }
}

export function getArchiveStream(filePath: string) {
  return createReadStream(filePath)
}

export async function getArchiveSize(filePath: string): Promise<number> {
  const stats = await stat(filePath)
  return stats.size
}
