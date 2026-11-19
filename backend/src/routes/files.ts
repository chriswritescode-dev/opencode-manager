import { Hono, type Context } from 'hono'
import { Readable } from 'node:stream'
import { z } from 'zod'
import * as fileService from '../services/files'
import * as archiveService from '../services/archive'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'

function decodeFilePath(path: string): string {
  return decodeURIComponent(path)
}

function getFilePathFromRequest(c: Context, fallbackPath: string): string {
  return c.req.query('path') ?? decodeFilePath(fallbackPath)
}

function getSpecialRoutePathFromRequest(c: Context, routeName: string): string | undefined {
  const queryPath = c.req.query('path')
  if (queryPath !== undefined) {
    return queryPath
  }

  const match = c.req.path.match(new RegExp(`/api/files/(.+?)/${routeName}$`))
  return match?.[1] ? decodeFilePath(match[1]) : undefined
}

function buildWeakEtag(size: number, lastModified: Date): string {
  return `W/"${size}-${lastModified.getTime()}"`
}

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) {
    return false
  }

  const values = ifNoneMatch.split(',').map((value) => value.trim())
  return values.includes('*') || values.includes(etag)
}

export type FileRoutesService = Pick<
  typeof fileService,
  | 'getFile'
  | 'getRawFileContent'
  | 'getRawFileMetadata'
  | 'getFileRange'
  | 'uploadFile'
  | 'createFileOrFolder'
  | 'deleteFileOrFolder'
  | 'renameOrMoveFile'
  | 'applyFilePatches'
>

export type FileArchiveRoutesService = Pick<
  typeof archiveService,
  | 'createDirectoryArchive'
  | 'getArchiveSize'
  | 'getArchiveStream'
  | 'deleteArchive'
  | 'getIgnoredPathsList'
>

export function createFileRoutes(
  files: FileRoutesService = fileService,
  archives: FileArchiveRoutesService = archiveService,
) {
  const app = new Hono()

  app.get('*', async (c) => {
    const path = c.req.path

    if (path.endsWith('/download-zip')) {
      const userPath = getSpecialRoutePathFromRequest(c, 'download-zip')

      if (!userPath) {
        return c.json({ error: 'No path provided' }, 400)
      }

      try {
        logger.info(`Starting ZIP archive creation for ${userPath}`)

        const includeGit = c.req.query('includeGit') === 'true'
        const includePathsParam = c.req.query('includePaths')
        const includePaths = includePathsParam ? includePathsParam.split(',').map((p: string) => p.trim()) : undefined

        const options: import('../services/archive').ArchiveOptions = {
          includeGit,
          includePaths
        }

        const archivePath = await archives.createDirectoryArchive(userPath, undefined, options)
        const archiveSize = await archives.getArchiveSize(archivePath)
        const archiveStream = archives.getArchiveStream(archivePath)
        const dirName = userPath.split('/').pop() || 'download'

        logger.info(`ZIP archive created: ${archivePath} (${archiveSize} bytes)`)

        archiveStream.on('end', () => {
          archives.deleteArchive(archivePath)
        })

        archiveStream.on('error', () => {
          archives.deleteArchive(archivePath)
        })

        return new Response(Readable.toWeb(archiveStream), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${dirName}.zip"`,
            'Content-Length': archiveSize.toString(),
          },
        })
      } catch (error: unknown) {
        logger.error('Failed to create directory archive:', error)
        return c.json({ error: getErrorMessage(error) || 'Failed to create archive' }, getStatusCode(error))
      }
    }

    if (path.endsWith('/ignored-paths')) {
      const userPath = getSpecialRoutePathFromRequest(c, 'ignored-paths')

      if (!userPath || userPath === '/ignored-paths') {
        return c.json({ error: 'No path provided' }, 400)
      }

      try {
        const ignoredPaths = await archives.getIgnoredPathsList(userPath)
        return c.json({ ignoredPaths })
      } catch (error: unknown) {
        logger.error('Failed to get ignored paths:', error)
        return c.json({ error: getErrorMessage(error) || 'Failed to get ignored paths' }, getStatusCode(error))
      }
    }

    try {
      const userPath = getFilePathFromRequest(c, path.replace(/^\/api\/files\//, '') || '')
      const download = c.req.query('download') === 'true'
      const raw = c.req.query('raw') === 'true'
      const startLineParam = c.req.query('startLine')
      const endLineParam = c.req.query('endLine')
      
      if (startLineParam !== undefined && endLineParam !== undefined) {
        const startLine = parseInt(startLineParam, 10)
        const endLine = parseInt(endLineParam, 10)
        
        if (isNaN(startLine) || isNaN(endLine) || startLine < 0 || endLine <= startLine) {
          return c.json({ error: 'Invalid line range parameters' }, 400)
        }
        
        const result = await files.getFileRange(userPath, startLine, endLine)
        return c.json(result)
      }
      
      if (raw) {
        const metadata = await files.getRawFileMetadata(userPath)

        if (!metadata) {
          const result = await files.getFile(userPath)
          return c.json(result)
        }

        const etag = buildWeakEtag(metadata.size, metadata.lastModified)
        const lastModified = metadata.lastModified.toUTCString()

        if (matchesIfNoneMatch(c.req.header('if-none-match'), etag)) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': etag,
              'Last-Modified': lastModified,
              'Cache-Control': 'no-cache',
              'Content-Security-Policy': 'sandbox allow-scripts',
              'X-Content-Type-Options': 'nosniff',
            },
          })
        }

        const content = await files.getRawFileContent(userPath)
        return new Response(content, {
          headers: {
            'Content-Type': metadata.mimeType,
            'Content-Length': content.byteLength.toString(),
            'Content-Security-Policy': 'sandbox allow-scripts',
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'ETag': etag,
            'Last-Modified': lastModified,
          }
        })
      }

      const result = await files.getFile(userPath)

      if (download && !result.isDirectory) {
        const content = result.content ? Buffer.from(result.content, 'base64') : Buffer.alloc(0)
        return new Response(content, {
          headers: {
            'Content-Type': result.mimeType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${result.name}"`,
            'Content-Length': result.size.toString(),
          }
        })
      }
      
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to get file:', error)
      return c.json({ error: getErrorMessage(error) || 'Failed to get file' }, getStatusCode(error))
    }
  })

  app.post('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.parseBody()
      
      const file = body.file
      if (!(file instanceof File)) {
        return c.json({ error: 'No file provided' }, 400)
      }

      const relativePath = z.string().safeParse(body.relativePath)
      const result = await files.uploadFile(path, file, relativePath.success ? relativePath.data : undefined)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to upload file:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error))
    }
  })

  app.put('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.json()
      
      const result = await files.createFileOrFolder(path, body)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to create file/folder:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error))
    }
  })

  app.delete('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      
      await files.deleteFileOrFolder(path)
      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to delete file/folder:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error))
    }
  })

  app.patch('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.json()
      
      if (body.patches && Array.isArray(body.patches)) {
        const result = await files.applyFilePatches(path, body.patches)
        return c.json(result)
      }
      
      const result = await files.renameOrMoveFile(path, body)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to patch file:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error))
    }
  })

  return app
}
