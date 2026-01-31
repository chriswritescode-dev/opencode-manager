import archiver from 'archiver'
import { createWriteStream, createReadStream } from 'fs'
import { readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { logger } from '../utils/logger'

export interface ArchiveOptions {
  includeGit?: boolean
  includePaths?: string[]
}

async function findGitRoot(startPath: string): Promise<string | null> {
  try {
    const { spawn } = await import('child_process')
    
    return new Promise((resolve) => {
      const proc = spawn('git', ['rev-parse', '--show-toplevel'], {
        cwd: startPath,
        shell: false
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim())
        } else {
          logger.debug(`Not a git repository: ${startPath}`, { stderr: stderr.trim() })
          resolve(null)
        }
      })

      proc.on('error', (err) => {
        logger.debug(`Failed to find git root: ${err.message}`)
        resolve(null)
      })
    })
  } catch {
    return null
  }
}

async function getIgnoredPaths(gitRoot: string, targetPath: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()

  try {
    const { spawn } = await import('child_process')
    
    const targetRelativeToRoot = path.relative(gitRoot, targetPath)
    console.log('[getIgnoredPaths] gitRoot:', gitRoot, 'targetPath:', targetPath, 'targetRelativeToRoot:', targetRelativeToRoot)
    
    const relativePaths = paths.map(p => {
      const relativeToTarget = p
      return targetRelativeToRoot ? path.join(targetRelativeToRoot, relativeToTarget) : relativeToTarget
    })
    
    console.log('[getIgnoredPaths] First 5 relativePaths:', relativePaths.slice(0, 5))
    
    return new Promise((resolve) => {
      const ignored = new Set<string>()
      const proc = spawn('git', ['check-ignore', '--stdin'], {
        cwd: gitRoot,
        shell: false
      })

      let stdout = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stdin?.write(relativePaths.join('\n'))
      proc.stdin?.end()

      proc.on('close', (code) => {
        console.log('[getIgnoredPaths] git check-ignore exited with code:', code)
        const ignoredFullPaths = stdout.split('\n').filter(p => p.trim())
        console.log('[getIgnoredPaths] Raw ignored count:', ignoredFullPaths.length, 'first 5:', ignoredFullPaths.slice(0, 5))
        const targetRelativeToRoot = path.relative(gitRoot, targetPath)
        
        for (const fullPath of ignoredFullPaths) {
          let relativePath = fullPath
          if (targetRelativeToRoot && fullPath.startsWith(targetRelativeToRoot + '/')) {
            relativePath = fullPath.slice(targetRelativeToRoot.length + 1)
          } else if (targetRelativeToRoot && fullPath === targetRelativeToRoot) {
            relativePath = ''
          }
          if (relativePath) {
            ignored.add(relativePath)
          }
        }
        console.log('[getIgnoredPaths] Final ignored set size:', ignored.size)
        resolve(ignored)
      })

      proc.on('error', (err) => {
        logger.debug(`git check-ignore error: ${err.message}`)
        resolve(new Set())
      })
    })
  } catch (err) {
    logger.debug(`getIgnoredPaths error: ${err}`)
    return new Set()
  }
}

async function collectFiles(
  repoPath: string,
  relativePath: string = '',
  options?: ArchiveOptions
): Promise<string[]> {
  const fullPath = path.join(repoPath, relativePath)
  const entries = await readdir(fullPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name
    
    if (entry.name === '.git' && !options?.includeGit) continue
    
    if (entry.isDirectory()) {
      files.push(entryRelPath + '/')
      const subFiles = await collectFiles(repoPath, entryRelPath, options)
      files.push(...subFiles)
    } else {
      files.push(entryRelPath)
    }
  }

  return files
}

async function filterIgnoredPaths(targetPath: string, allPaths: string[], options?: ArchiveOptions): Promise<string[]> {
  const gitRoot = await findGitRoot(targetPath)
  
  if (!gitRoot) {
    return allPaths
  }
  
  const batchSize = 1000
  const ignoredSet = new Set<string>()

  for (let i = 0; i < allPaths.length; i += batchSize) {
    const batch = allPaths.slice(i, i + batchSize)
    const ignored = await getIgnoredPaths(gitRoot, targetPath, batch)
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
  const includePathsSet = new Set(options?.includePaths || [])

  for (const p of allPaths) {
    const isDir = p.endsWith('/')
    const cleanPath = isDir ? p.slice(0, -1) : p

    if (includePathsSet.has(cleanPath) || includePathsSet.has(p)) {
      filteredPaths.push(p)
      continue
    }

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

export async function createRepoArchive(repoPath: string, options?: ArchiveOptions): Promise<string> {
  const repoName = path.basename(repoPath)
  const tempFile = path.join(os.tmpdir(), `${repoName}-${Date.now()}.zip`)

  logger.info(`Creating archive for ${repoPath} at ${tempFile}`)

  const allPaths = await collectFiles(repoPath, '', options)
  const filteredPaths = await filterIgnoredPaths(repoPath, allPaths, options)

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

export async function createDirectoryArchive(directoryPath: string, archiveName?: string, options?: ArchiveOptions): Promise<string> {
  const dirName = archiveName || path.basename(directoryPath)
  const tempFile = path.join(os.tmpdir(), `${dirName}-${Date.now()}.zip`)

  logger.info(`Creating archive for directory ${directoryPath} at ${tempFile}`)

  const allPaths = await collectFiles(directoryPath, '', options)

  const filteredPaths = await filterIgnoredPaths(directoryPath, allPaths, options)

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

      const fullPath = path.join(directoryPath, relativePath)
      const archivePath = path.join(dirName, relativePath)
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

export async function getIgnoredPathsList(directoryPath: string): Promise<string[]> {
  console.log('[getIgnoredPathsList] Starting for:', directoryPath)
  const gitRoot = await findGitRoot(directoryPath)
  console.log('[getIgnoredPathsList] Git root:', gitRoot)
  
  if (!gitRoot) {
    console.log('[getIgnoredPathsList] No git root found')
    const hasGitDir = await collectFiles(directoryPath).then(
      paths => paths.some(p => p.startsWith('.git/') || p === '.git')
    ).catch(() => false)
    
    if (hasGitDir) {
      console.log('[getIgnoredPathsList] Has .git dir, returning [.git/]')
      return ['.git/']
    }
    console.log('[getIgnoredPathsList] No .git dir, returning []')
    return []
  }
  
  const allPaths = await collectFiles(directoryPath)
  console.log('[getIgnoredPathsList] Collected', allPaths.length, 'paths')
  const ignoredSet = new Set<string>()
  const batchSize = 1000

  for (let i = 0; i < allPaths.length; i += batchSize) {
    const batch = allPaths.slice(i, i + batchSize)
    console.log('[getIgnoredPathsList] Checking batch', i, 'to', i + batch.length)
    const ignored = await getIgnoredPaths(gitRoot, directoryPath, batch)
    console.log('[getIgnoredPathsList] Batch ignored count:', ignored.size)
    for (const p of ignored) {
      ignoredSet.add(p)
      if (p.endsWith('/')) {
        ignoredSet.add(p.slice(0, -1))
      } else {
        ignoredSet.add(p + '/')
      }
    }
  }
  
  console.log('[getIgnoredPathsList] Total ignored set size:', ignoredSet.size)

  const ignoredDirs: string[] = []
  const processedDirs = new Set<string>()

  for (const p of allPaths) {
    const isDir = p.endsWith('/')
    const cleanPath = isDir ? p.slice(0, -1) : p
    
    if (ignoredSet.has(p) || ignoredSet.has(cleanPath)) {
      let isUnderIgnoredDir = false
      for (const ignoredDir of processedDirs) {
        if (cleanPath.startsWith(ignoredDir + '/')) {
          isUnderIgnoredDir = true
          break
        }
      }
      
      if (!isUnderIgnoredDir) {
        const dirPath = isDir ? p : cleanPath + '/'
        ignoredDirs.push(dirPath)
        processedDirs.add(cleanPath)
      }
    }
  }

  const gitDirExists = await stat(path.join(directoryPath, '.git')).then(() => true).catch(() => false)
  console.log('[getIgnoredPathsList] .git exists:', gitDirExists)
  if (gitDirExists && !ignoredDirs.some(p => p.startsWith('.git'))) {
    ignoredDirs.push('.git/')
  }

  ignoredDirs.sort()
  
  console.log('[getIgnoredPathsList] Final result:', ignoredDirs)

  return ignoredDirs
}
