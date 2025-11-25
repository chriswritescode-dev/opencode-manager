import { promises as fs } from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { getReposPath } from '../config'

export async function readFileContent(filePath: string): Promise<string> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    return await fs.readFile(fullPath, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`)
  }
}

export async function readFileAsBase64(filePath: string): Promise<string> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    const buffer = await fs.readFile(fullPath)
    return buffer.toString('base64')
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`)
  }
}

export async function writeFileContent(
  filePath: string, 
  content: string | Buffer
): Promise<void> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    
    await fs.writeFile(fullPath, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'))
    logger.info(`Wrote file to: ${fullPath}`)
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error}`)
  }
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.resolve(dirPath)
    await fs.mkdir(fullPath, { recursive: true })
  } catch (error) {
    throw new Error(`Failed to create directory ${dirPath}: ${error}`)
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    await fs.access(fullPath)
    return true
  } catch {
    return false
  }
}



export async function deletePath(filePath: string): Promise<void> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    const stats = await fs.stat(fullPath)
    
    if (stats.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true })
    } else {
      await fs.unlink(fullPath)
    }
  } catch (error) {
    throw new Error(`Failed to delete path ${filePath}: ${error}`)
  }
}

export async function getFileStats(filePath: string): Promise<{ size: number; lastModified: Date; isDirectory: boolean }> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getReposPath(), filePath)
    const stats = await fs.stat(fullPath)
    
    return {
      size: stats.size,
      lastModified: stats.mtime,
      isDirectory: stats.isDirectory()
    }
  } catch (error) {
    throw new Error(`Failed to get stats for ${filePath}: ${error}`)
  }
}

export async function listDirectory(dirPath: string): Promise<Array<{
  name: string
  path: string
  isDirectory: boolean
  size: number
  lastModified: Date
}>> {
  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getReposPath(), dirPath)
    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    
    const result = []
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      
      const entryPath = path.join(fullPath, entry.name)
      const stats = await fs.stat(entryPath)
      
      result.push({
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stats.size,
        lastModified: stats.mtime
      })
    }
    
    return result
  } catch (error) {
    throw new Error(`Failed to list directory ${dirPath}: ${error}`)
  }
}
