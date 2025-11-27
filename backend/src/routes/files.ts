import { Hono } from 'hono'
import * as fileService from '../services/files'
import type { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export function createFileRoutes(_database: Database) {
  const app = new Hono()

  app.get('/*', async (c) => {
    try {
      const userPath = c.req.path.replace(/^\/api\/files\//, '') || ''
      const download = c.req.query('download') === 'true'
      const raw = c.req.query('raw') === 'true'
      const startLineParam = c.req.query('startLine')
      const endLineParam = c.req.query('endLine')
      
      if (startLineParam !== undefined && endLineParam !== undefined) {
        const startLine = parseInt(startLineParam, 10)
        const endLine = parseInt(endLineParam, 10)
        
        if (isNaN(startLine) || isNaN(endLine) || startLine < 0 || endLine < startLine) {
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
    } catch (error: any) {
      logger.error('Failed to get file:', error)
      return c.json({ error: error.message || 'Failed to get file' }, error.statusCode || 500)
    }
  })

  app.post('/*', async (c) => {
    try {
      const path = c.req.path.replace(/^\/api\/files\//, '') || ''
      const body = await c.req.parseBody()
      
      const file = body.file as File
      if (!file) {
        return c.json({ error: 'No file provided' }, 400)
      }
      
      const result = await fileService.uploadFile(path, file)
      return c.json(result)
    } catch (error: any) {
      logger.error('Failed to upload file:', error)
      return c.json({ error: error.message }, error.statusCode || 500)
    }
  })

  app.put('/*', async (c) => {
    try {
      const path = c.req.path.replace(/^\/api\/files\//, '') || ''
      const body = await c.req.json()
      
      const result = await fileService.createFileOrFolder(path, body)
      return c.json(result)
    } catch (error: any) {
      logger.error('Failed to create file/folder:', error)
      return c.json({ error: error.message }, error.statusCode || 500)
    }
  })

  app.delete('/*', async (c) => {
    try {
      const path = c.req.path.replace(/^\/api\/files\//, '') || ''
      
      await fileService.deleteFileOrFolder(path)
      return c.json({ success: true })
    } catch (error: any) {
      logger.error('Failed to delete file/folder:', error)
      return c.json({ error: error.message }, error.statusCode || 500)
    }
  })

  app.patch('/*', async (c) => {
    try {
      const path = c.req.path.replace(/^\/api\/files\//, '') || ''
      const body = await c.req.json()
      
      if (body.patches && Array.isArray(body.patches)) {
        const result = await fileService.applyFilePatches(path, body.patches)
        return c.json(result)
      }
      
      const result = await fileService.renameOrMoveFile(path, body)
      return c.json(result)
    } catch (error: any) {
      logger.error('Failed to patch file:', error)
      return c.json({ error: error.message }, error.statusCode || 500)
    }
  })

  return app
}