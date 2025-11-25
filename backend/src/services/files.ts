import fs from 'fs/promises'
import path from 'path'
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
import { FILE_LIMITS, ALLOWED_MIME_TYPES, getReposPath } from '../config'

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

export async function uploadFile(userPath: string, file: File): Promise<FileUploadResult> {
  if (file.size > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('File too large')
  }
  
  const mimeType = file.type || getMimeType(file.name, new Uint8Array())
  if (!ALLOWED_MIME_TYPES.includes(mimeType as any) && !mimeType.startsWith('text/')) {
    throw new Error('File type not allowed')
  }
  
  const validatedPath = validatePath(userPath)
  const fileName = file.name || path.basename(userPath)
  const fullPath = path.join(validatedPath, fileName)
  
  const buffer = await file.arrayBuffer()
  
  await writeFileContent(fullPath, Buffer.from(buffer))
  
  return {
    name: fileName,
    path: path.join(userPath, fileName),
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

function getMimeType(filePath: string, content: Uint8Array): string {
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