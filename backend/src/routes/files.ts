import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
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

function getPreviewPathFromRequest(c: Context): string | undefined {
  const path = c.req.path
  const prefix = '/api/files/preview'

  const queryPath = c.req.query('path')
  if (queryPath !== undefined) {
    return queryPath
  }

  if (path.startsWith(prefix + '/')) {
    const previewPath = path.slice(prefix.length + 1)
    return decodeURIComponent(previewPath)
  }

  return undefined
}

const PREVIEWABLE_MIME_TYPES = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'application/xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
])

function isPreviewableMimeType(mimeType?: string): boolean {
  return mimeType !== undefined && PREVIEWABLE_MIME_TYPES.has(mimeType)
}

function getPreviewHeaders(result: { name: string; size: number; mimeType?: string }): Record<string, string> {
  const isHtmlSvg = result.mimeType === 'text/html' || result.mimeType === 'image/svg+xml'
  const headers: Record<string, string> = {
    'Content-Type': result.mimeType || 'application/octet-stream',
    'Content-Length': result.size.toString(),
    'Content-Disposition': `inline; filename="${result.name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }

  if (isHtmlSvg) {
    headers['Content-Security-Policy'] = [
      'sandbox allow-scripts;',
      "default-src 'self' http: https: data: blob: 'unsafe-inline' 'unsafe-eval';",
      "script-src 'self' http: https: 'unsafe-inline' 'unsafe-eval';",
      "style-src 'self' http: https: 'unsafe-inline';",
      "img-src 'self' http: https: data: blob:;",
      "font-src 'self' http: https: data:;",
      "connect-src 'self' http: https:;",
      "media-src 'self' http: https: data: blob:;",
      "object-src 'none';",
      "base-uri 'none';",
      "frame-ancestors 'self'",
    ].join(' ')
  }

  return headers
}

export function createFileRoutes() {
  const app = new Hono()

  app.get('*', async (c) => {
    const path = c.req.path

    if (path === '/api/files/preview' || path.startsWith('/api/files/preview/')) {
      const userPath = getPreviewPathFromRequest(c)

      if (!userPath) {
        return c.json({ error: 'No path provided' }, 400)
      }

      try {
        const result = await fileService.getFile(userPath)

        if (result.isDirectory) {
          return c.json({ error: 'Cannot preview directories' }, 400)
        }

        if (!isPreviewableMimeType(result.mimeType)) {
          return c.json({ error: 'File type cannot be previewed' }, 415)
        }

        const content = await fileService.getRawFileContent(userPath)
        const headers = getPreviewHeaders(result)

        return new Response(content, { headers })
      } catch (error: unknown) {
        logger.error('Failed to preview file:', error)
        return c.json({ error: getErrorMessage(error) || 'Failed to preview file' }, getStatusCode(error) as ContentfulStatusCode)
      }
    }

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

        const archivePath = await archiveService.createDirectoryArchive(userPath, undefined, options)
        const archiveSize = await archiveService.getArchiveSize(archivePath)
        const archiveStream = archiveService.getArchiveStream(archivePath)
        const dirName = userPath.split('/').pop() || 'download'

        logger.info(`ZIP archive created: ${archivePath} (${archiveSize} bytes)`)

        archiveStream.on('end', () => {
          archiveService.deleteArchive(archivePath)
        })

        archiveStream.on('error', () => {
          archiveService.deleteArchive(archivePath)
        })

        return new Response(archiveStream as unknown as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${dirName}.zip"`,
            'Content-Length': archiveSize.toString(),
          },
        })
      } catch (error: unknown) {
        logger.error('Failed to create directory archive:', error)
        return c.json({ error: getErrorMessage(error) || 'Failed to create archive' }, getStatusCode(error) as ContentfulStatusCode)
      }
    }

    if (path.endsWith('/ignored-paths')) {
      const userPath = getSpecialRoutePathFromRequest(c, 'ignored-paths')

      if (!userPath || userPath === '/ignored-paths') {
        return c.json({ error: 'No path provided' }, 400)
      }

      try {
        const ignoredPaths = await archiveService.getIgnoredPathsList(userPath)
        return c.json({ ignoredPaths })
      } catch (error: unknown) {
        logger.error('Failed to get ignored paths:', error)
        return c.json({ error: getErrorMessage(error) || 'Failed to get ignored paths' }, getStatusCode(error) as ContentfulStatusCode)
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
        
        const result = await fileService.getFileRange(userPath, startLine, endLine)
        return c.json(result)
      }
      
      const result = await fileService.getFile(userPath)
      
      if (raw && !result.isDirectory) {
        const content = await fileService.getRawFileContent(userPath)
        return new Response(content, {
          headers: {
            'Content-Type': result.mimeType || 'application/octet-stream',
            'Content-Length': result.size.toString(),
          }
        })
      }
      
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
      return c.json({ error: getErrorMessage(error) || 'Failed to get file' }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.post('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.parseBody()
      
      const file = body.file as File
      if (!file) {
        return c.json({ error: 'No file provided' }, 400)
      }
      
      const relativePath = body.relativePath as string | undefined
      const result = await fileService.uploadFile(path, file, relativePath)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to upload file:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.put('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.json()
      
      const result = await fileService.createFileOrFolder(path, body)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to create file/folder:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.delete('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      
      await fileService.deleteFileOrFolder(path)
      return c.json({ success: true })
    } catch (error: unknown) {
      logger.error('Failed to delete file/folder:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  app.patch('/*', async (c) => {
    try {
      const path = getFilePathFromRequest(c, c.req.path.replace(/^\/api\/files\//, '') || '')
      const body = await c.req.json()
      
      if (body.patches && Array.isArray(body.patches)) {
        const result = await fileService.applyFilePatches(path, body.patches)
        return c.json(result)
      }
      
      const result = await fileService.renameOrMoveFile(path, body)
      return c.json(result)
    } catch (error: unknown) {
      logger.error('Failed to patch file:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })

  return app
}
