import fs from 'fs/promises'
import path from 'path'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { logger } from '../utils/logger'

import { 
  readFileContent, 
  readFileAsBase64,
  writeFileContent, 
  fileExists, 
  deletePath, 
  getFileStats, 
  listDirectory 
} from './file-operations'
import { FILE_LIMITS, ALLOWED_MIME_TYPES, getReposPath } from '@opencode-manager/shared'
import type { ChunkedFileInfo, PatchOperation } from '@opencode-manager/shared'

const SHARED_WORKSPACE_BASE = getReposPath()

interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mimeType?: string
  content?: string
  children?: FileInfo[]
  lastModified: Date
  workspaceRoot?: string
}

interface FileUploadResult {
  name: string
  path: string
  size: number
  mimeType: string
}

export async function getRawFileContent(userPath: string): Promise<Buffer> {
  const validatedPath = validatePath(userPath)
  logger.info(`Getting raw file content for path: ${userPath} -> ${validatedPath}`)
  
  try {
    const exists = await fileExists(validatedPath)
    if (!exists) {
      throw new Error('File does not exist')
    }
    
    const stats = await getFileStats(validatedPath)
    if (stats.isDirectory) {
      throw new Error('Path is a directory')
    }
    
    return await fs.readFile(validatedPath)
  } catch (error) {
    logger.error(`Failed to read raw file content ${validatedPath}:`, error)
    throw { message: 'File not found or cannot be read', statusCode: 404 }
  }
}

export async function getFile(userPath: string): Promise<FileInfo> {
  const validatedPath = validatePath(userPath)
  logger.info(`Getting file for path: ${userPath} -> ${validatedPath}`)
  
  try {
    // Check if path exists
    const exists = await fileExists(validatedPath)
    if (!exists) {
      throw new Error('Path does not exist')
    }
    
    // Get file stats
    const stats = await getFileStats(validatedPath)
    
    if (stats.isDirectory) {
      // It's a directory - list contents
      const entries = await listDirectory(validatedPath)
      const children: FileInfo[] = []
      
      for (const entry of entries) {
        children.push({
          name: entry.name,
          path: path.join(userPath, entry.name),
          isDirectory: entry.isDirectory,
          size: entry.size,
          lastModified: entry.lastModified,
        })
      }
      
      return {
        name: path.basename(validatedPath),
        path: userPath,
        isDirectory: true,
        size: 0,
        children: children.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        }),
        lastModified: stats.lastModified,
        workspaceRoot: SHARED_WORKSPACE_BASE,
      }
    } else {
      // It's a file - get content
      let content = ''
      let mimeType = getMimeType(validatedPath, new Uint8Array())
      
      if (stats.size < FILE_LIMITS.MAX_SIZE_BYTES) {
        try {
          const mimeType = getMimeType(validatedPath, new Uint8Array())
          
          if (mimeType.startsWith('image/') || !mimeType.startsWith('text/')) {
            content = await readFileAsBase64(validatedPath)
          } else {
            const fileOutput = await readFileContent(validatedPath)
            content = Buffer.from(fileOutput, 'utf8').toString('base64')
          }
        } catch (error) {
          logger.warn(`Failed to read file content: ${error}`)
        }
      }
      
      return {
        name: path.basename(validatedPath),
        path: userPath,
        isDirectory: false,
        size: stats.size,
        mimeType,
        content,
        lastModified: stats.lastModified,
      }
    }
  } catch (error) {
    logger.error(`Failed to access path ${validatedPath}:`, error)
    throw { message: 'File or directory not found', statusCode: 404 }
  }
}

export async function uploadFile(userPath: string, file: File, relativePath?: string): Promise<FileUploadResult> {
  if (file.size > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('File too large')
  }
  
  const mimeType = file.type || getMimeType(file.name, new Uint8Array())
  if (!ALLOWED_MIME_TYPES.includes(mimeType as any) && !mimeType.startsWith('text/')) {
    throw new Error('File type not allowed')
  }
  
  const validatedBasePath = validatePath(userPath)
  const targetRelativePath = relativePath || file.name || path.basename(userPath)
  const fullPath = path.join(validatedBasePath, targetRelativePath)
  
  const finalValidatedPath = validatePath(path.join(userPath, targetRelativePath))
  if (finalValidatedPath !== fullPath) {
    throw { message: 'Invalid relative path', statusCode: 400 }
  }
  
  const parentDir = path.dirname(fullPath)
  await fs.mkdir(parentDir, { recursive: true })
  
  const buffer = await file.arrayBuffer()
  
  await writeFileContent(fullPath, Buffer.from(buffer))
  
  return {
    name: path.basename(targetRelativePath),
    path: path.join(userPath, targetRelativePath),
    size: file.size,
    mimeType,
  }
}

export async function createFileOrFolder(userPath: string, body: { type: 'file' | 'folder', content?: string }): Promise<FileInfo> {
  const validatedPath = validatePath(userPath)
  
  if (body.type === 'folder') {
  await fs.mkdir(validatedPath, { recursive: true })
  return {
    name: path.basename(validatedPath),
    path: userPath,
    isDirectory: true,
    size: 0,
    lastModified: new Date(),
  }
} else {
  const content = body.content || ''
  
  if (content) {
    await writeFileContent(validatedPath, content)
  } else {
    await fs.writeFile(validatedPath, '')
  }
  
  return {
    name: path.basename(validatedPath),
    path: userPath,
    isDirectory: false,
    size: content.length,
    lastModified: new Date(),
  }
}
}

export async function deleteFileOrFolder(userPath: string): Promise<void> {
  const validatedPath = validatePath(userPath)
  
  await deletePath(validatedPath)
}

export async function renameOrMoveFile(userPath: string, body: { newPath: string }): Promise<FileInfo> {
  const oldValidatedPath = validatePath(userPath)
  const newValidatedPath = validatePath(body.newPath)
  
  // Create parent directory if needed
  await fs.mkdir(path.dirname(newValidatedPath), { recursive: true })
  
  // Move/rename file
  await fs.rename(oldValidatedPath, newValidatedPath)
  
  // Get stats of new file
  const stats = await getFileStats(newValidatedPath)
  
  return {
    name: path.basename(newValidatedPath),
    path: body.newPath,
    isDirectory: stats.isDirectory,
    size: stats.size,
    lastModified: stats.lastModified,
  }
}

function validatePath(userPath: string): string {
  const normalized = path.normalize(userPath).replace(/^(\.\.(\/|\\|$))+/, '')
  const fullPath = path.join(SHARED_WORKSPACE_BASE, normalized)
  const resolved = path.resolve(fullPath)
  
  const basePath = path.resolve(SHARED_WORKSPACE_BASE)
  if (!resolved.startsWith(basePath)) {
    throw { message: 'Path traversal detected', statusCode: 403 }
  }
  
  return resolved
}

function getMimeType(filePath: string, _content: Uint8Array): string {
  const ext = path.extname(filePath).toLowerCase()
  
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.jsx': 'text/javascript',
    '.tsx': 'text/typescript',
    '.json': 'application/json',
    '.jsonc': 'application/json',
    '.xml': 'application/xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  }
  
  return mimeTypes[ext] || 'text/plain'
}

async function countFileLines(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let lineCount = 0
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    
    rl.on('line', () => { lineCount++ })
    rl.on('close', () => resolve(lineCount))
    rl.on('error', reject)
  })
}

async function readFileLines(filePath: string, startLine: number, endLine: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let currentLine = 0
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    
    rl.on('line', (line) => {
      if (currentLine >= startLine && currentLine < endLine) {
        lines.push(line)
      }
      currentLine++
      if (currentLine >= endLine) {
        rl.close()
        stream.destroy()
      }
    })
    rl.on('close', () => resolve(lines))
    rl.on('error', reject)
  })
}

export async function getFileRange(userPath: string, startLine: number, endLine: number): Promise<ChunkedFileInfo> {
  const validatedPath = validatePath(userPath)
  logger.info(`Getting file range for path: ${userPath} lines ${startLine}-${endLine}`)
  
  const exists = await fileExists(validatedPath)
  if (!exists) {
    throw { message: 'File does not exist', statusCode: 404 }
  }
  
  const stats = await getFileStats(validatedPath)
  if (stats.isDirectory) {
    throw { message: 'Path is a directory', statusCode: 400 }
  }
  
  const totalLines = await countFileLines(validatedPath)
  const clampedEnd = Math.min(endLine, totalLines)
  const lines = await readFileLines(validatedPath, startLine, clampedEnd)
  const mimeType = getMimeType(validatedPath, new Uint8Array())
  
  return {
    name: path.basename(validatedPath),
    path: userPath,
    isDirectory: false as const,
    size: stats.size,
    mimeType,
    lines,
    totalLines,
    startLine,
    endLine: clampedEnd,
    hasMore: clampedEnd < totalLines,
    lastModified: stats.lastModified,
  }
}

export async function getFileTotalLines(userPath: string): Promise<number> {
  const validatedPath = validatePath(userPath)
  const exists = await fileExists(validatedPath)
  if (!exists) {
    throw { message: 'File does not exist', statusCode: 404 }
  }
  return countFileLines(validatedPath)
}

export async function applyFilePatches(userPath: string, patches: PatchOperation[]): Promise<{ success: boolean; totalLines: number }> {
  const validatedPath = validatePath(userPath)
  logger.info(`Applying ${patches.length} patches to: ${userPath}`)
  
  const exists = await fileExists(validatedPath)
  if (!exists) {
    throw { message: 'File does not exist', statusCode: 404 }
  }
  
  const content = await fs.readFile(validatedPath, 'utf8')
  const lines = content.split('\n')
  
  const sortedPatches = [...patches].sort((a, b) => b.startLine - a.startLine)
  
  for (const patch of sortedPatches) {
    const { type, startLine, endLine, content: patchContent } = patch
    
    switch (type) {
      case 'replace': {
        const end = endLine ?? startLine + 1
        const newLines = patchContent?.split('\n') ?? []
        lines.splice(startLine, end - startLine, ...newLines)
        break
      }
      case 'insert': {
        const newLines = patchContent?.split('\n') ?? []
        lines.splice(startLine, 0, ...newLines)
        break
      }
      case 'delete': {
        const end = endLine ?? startLine + 1
        lines.splice(startLine, end - startLine)
        break
      }
    }
  }
  
  await fs.writeFile(validatedPath, lines.join('\n'), 'utf8')
  
  return { success: true, totalLines: lines.length }
}