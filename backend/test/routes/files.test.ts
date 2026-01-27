import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFileRoutes } from '../../src/routes/files'
import { Hono } from 'hono'
import type { ReadStream } from 'fs'
import * as fileService from '../../src/services/files'
import * as archiveService from '../../src/services/archive'
import type { FileInfo, ChunkedFileInfo, PatchOperation } from '@opencode-manager/shared'

interface FileUploadResult {
  name: string
  path: string
  size: number
  mimeType: string
}

const getFile = vi.fn()
const getRawFileContent = vi.fn()
const getFileRange = vi.fn()
const uploadFile = vi.fn()
const createFileOrFolder = vi.fn()
const deleteFileOrFolder = vi.fn()
const renameOrMoveFile = vi.fn()
const applyFilePatches = vi.fn()

const createDirectoryArchive = vi.fn()
const getArchiveSize = vi.fn()
const getArchiveStream = vi.fn()
const deleteArchive = vi.fn()

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/test/repos'),
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

vi.mock('../../src/services/files', () => ({
  getFile,
  getRawFileContent,
  getFileRange,
  uploadFile,
  createFileOrFolder,
  deleteFileOrFolder,
  renameOrMoveFile,
  applyFilePatches,
}))

vi.mock('../../src/services/archive', () => ({
  createDirectoryArchive,
  getArchiveSize,
  getArchiveStream,
  deleteArchive,
}))

describe('File Routes', () => {
  let app: Hono
  let filesApp: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    filesApp = createFileRoutes()
    app = new Hono()
    app.route('/api/files', filesApp)
  })

  describe('GET /*/download-zip - Route Order Regression Test', () => {
    it('should route to archive service for directory download, not file service', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as ReadStream

      createDirectoryArchive.mockResolvedValue('/tmp/test-repo-123.zip')
      getArchiveSize.mockResolvedValue(1024)
      getArchiveStream.mockReturnValue(mockStream)

      const response = await app.request('/api/files/test-repo/src/download-zip')

      expect(createDirectoryArchive).toHaveBeenCalledWith('test-repo/src')
      expect(getArchiveSize).toHaveBeenCalledWith('/tmp/test-repo-123.zip')
      expect(getArchiveStream).toHaveBeenCalledWith('/tmp/test-repo-123.zip')
      expect(getFile).not.toHaveBeenCalled()

      expect(mockStream.on).toHaveBeenCalledWith('end', expect.any(Function))
      expect(mockStream.on).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should return 400 when no path provided', async () => {
      const response = await app.request('/api/files/download-zip')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'No path provided')
      expect(createDirectoryArchive).not.toHaveBeenCalled()
    })

    it('should return 500 when archive creation fails', async () => {
      createDirectoryArchive.mockRejectedValue(new Error('Directory not found'))

      const response = await app.request('/api/files/non-repo/download-zip')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /* - File/Directory Lookup', () => {
    const mockFileInfo: FileInfo = {
      name: 'test.txt',
      path: 'test-repo/test.txt',
      isDirectory: false,
      size: 100,
      mimeType: 'text/plain',
      content: Buffer.from('test content').toString('base64'),
      lastModified: new Date(),
    }

    const mockDirInfo: FileInfo = {
      name: 'src',
      path: 'test-repo/src',
      isDirectory: true,
      size: 0,
      children: [
        {
          name: 'file.ts',
          path: 'test-repo/src/file.ts',
          isDirectory: false,
          size: 200,
          lastModified: new Date(),
        },
      ],
      lastModified: new Date(),
    }

    it('should return directory listing when path is directory', async () => {
      getFile.mockResolvedValue(mockDirInfo)

      const response = await app.request('/api/files/test-repo/src')
      const body = await response.json() as FileInfo

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('isDirectory', true)
      expect(body).toHaveProperty('children')
      expect(Array.isArray(body.children)).toBe(true)
      expect(getFile).toHaveBeenCalledWith('test-repo/src')
    })

    it('should return file info when no query params', async () => {
      getFile.mockResolvedValue(mockFileInfo)

      const response = await app.request('/api/files/test-repo/test.txt')
      const body = await response.json() as FileInfo

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('isDirectory', false)
      expect(body).toHaveProperty('content')
      expect(getFile).toHaveBeenCalledWith('test-repo/test.txt')
    })

    it('should return 404 when path does not exist', async () => {
      getFile.mockRejectedValue({ message: 'File or directory not found', statusCode: 404 })

      const response = await app.request('/api/files/test-repo/nonexistent.txt')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /* with ?startLine&endLine - File Range', () => {
    const mockChunkedInfo: ChunkedFileInfo = {
      name: 'test.ts',
      path: 'test-repo/test.ts',
      isDirectory: false,
      size: 500,
      mimeType: 'text/typescript',
      lines: ['line 5', 'line 6', 'line 7', 'line 8', 'line 9'],
      totalLines: 100,
      startLine: 5,
      endLine: 10,
      hasMore: true,
      lastModified: new Date(),
    }

    it('should return file range for valid parameters', async () => {
      getFileRange.mockResolvedValue(mockChunkedInfo)

      const response = await app.request('/api/files/test-repo/test.ts?startLine=5&endLine=10')
      const body = await response.json() as ChunkedFileInfo

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('startLine', 5)
      expect(body).toHaveProperty('endLine', 10)
      expect(body).toHaveProperty('lines')
      expect(body).toHaveProperty('totalLines', 100)
      expect(getFileRange).toHaveBeenCalledWith('test-repo/test.ts', 5, 10)
    })

    it('should return 400 for invalid startLine', async () => {
      const response = await app.request('/api/files/test-repo/test.ts?startLine=invalid&endLine=10')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'Invalid line range parameters')
    })

    it('should return 400 for invalid endLine', async () => {
      const response = await app.request('/api/files/test-repo/test.ts?startLine=0&endLine=invalid')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'Invalid line range parameters')
    })

    it('should return 400 when startLine equals endLine', async () => {
      const response = await app.request('/api/files/test-repo/test.ts?startLine=10&endLine=10')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'Invalid line range parameters')
    })

    it('should return 400 for negative startLine', async () => {
      const response = await app.request('/api/files/test-repo/test.ts?startLine=-5&endLine=10')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'Invalid line range parameters')
    })
  })

  describe('POST /* - File Upload', () => {
    it('should upload file successfully', async () => {
      const mockResult: FileUploadResult = {
        name: 'test.txt',
        path: 'test-repo/test.txt',
        size: 100,
        mimeType: 'text/plain',
      }
      uploadFile.mockResolvedValue(mockResult)

      const file = new File(['content'], 'test.txt', { type: 'text/plain' })
      const formData = new FormData()
      formData.append('file', file)

      const response = await app.request('/api/files/test-repo', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json() as FileUploadResult

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('name', 'test.txt')
      expect(body).toHaveProperty('path', 'test-repo/test.txt')
      expect(uploadFile).toHaveBeenCalled()
    })

    it('should return 400 when no file provided', async () => {
      const formData = new FormData()

      const response = await app.request('/api/files/test-repo', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'No file provided')
      expect(uploadFile).not.toHaveBeenCalled()
    })

    it('should handle file too large error', async () => {
      uploadFile.mockRejectedValue(new Error('File too large'))

      const file = new File(['content'], 'large.bin', { type: 'application/octet-stream' })
      const formData = new FormData()
      formData.append('file', file)

      const response = await app.request('/api/files/test-repo', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json() as { error: string }

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error', 'File too large')
    })
  })

  describe('PUT /* - Create File/Folder', () => {
    const mockFileResult: FileInfo = {
      name: 'newfile.ts',
      path: 'test-repo/newfile.ts',
      isDirectory: false,
      size: 50,
      lastModified: new Date(),
    }

    const mockFolderResult: FileInfo = {
      name: 'newfolder',
      path: 'test-repo/newfolder',
      isDirectory: true,
      size: 0,
      lastModified: new Date(),
    }

    it('should create file successfully', async () => {
      createFileOrFolder.mockResolvedValue(mockFileResult)

      const response = await app.request('/api/files/test-repo/newfile.ts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', content: 'export const x = 1' }),
      })
      const body = await response.json() as FileInfo

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('isDirectory', false)
      expect(body).toHaveProperty('size', 50)
      expect(createFileOrFolder).toHaveBeenCalledWith('test-repo/newfile.ts', {
        type: 'file',
        content: 'export const x = 1',
      })
    })

    it('should create folder successfully', async () => {
      createFileOrFolder.mockResolvedValue(mockFolderResult)

      const response = await app.request('/api/files/test-repo/newfolder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'folder' }),
      })
      const body = await response.json() as FileInfo

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('isDirectory', true)
      expect(createFileOrFolder).toHaveBeenCalledWith('test-repo/newfolder', {
        type: 'folder',
      })
    })

    it('should return 500 when creation fails', async () => {
      createFileOrFolder.mockRejectedValue(new Error('Permission denied'))

      const response = await app.request('/api/files/test-repo/newfile.ts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file' }),
      })
      const body = await response.json() as { error: string }

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('DELETE /* - Delete File/Folder', () => {
    it('should delete file successfully', async () => {
      deleteFileOrFolder.mockResolvedValue(undefined)

      const response = await app.request('/api/files/test-repo/oldfile.ts', {
        method: 'DELETE',
      })
      const body = await response.json() as { success: boolean }

      expect(response.status).toBe(200)
      expect(body).toEqual({ success: true })
      expect(deleteFileOrFolder).toHaveBeenCalledWith('test-repo/oldfile.ts')
    })

    it('should delete folder successfully', async () => {
      deleteFileOrFolder.mockResolvedValue(undefined)

      const response = await app.request('/api/files/test-repo/oldfolder', {
        method: 'DELETE',
      })
      const body = await response.json() as { success: boolean }

      expect(response.status).toBe(200)
      expect(body).toEqual({ success: true })
    })

    it('should return error when deletion fails', async () => {
      deleteFileOrFolder.mockRejectedValue(new Error('File not found'))

      const response = await app.request('/api/files/test-repo/nonexistent.ts', {
        method: 'DELETE',
      })
      const body = await response.json() as { error: string }

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error')
    })
  })

  describe('PATCH /* - File Operations', () => {
    const mockRenameResult: FileInfo = {
      name: 'renamed.ts',
      path: 'test-repo/renamed.ts',
      isDirectory: false,
      size: 200,
      lastModified: new Date(),
    }

    describe('Apply Patches', () => {
      it('should apply patches successfully', async () => {
        applyFilePatches.mockResolvedValue({ success: true, totalLines: 150 })

        const response = await app.request('/api/files/test-repo/test.ts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patches: [
              { type: 'replace' as const, startLine: 10, content: 'new line\n' },
            ],
          }),
        })
        const body = await response.json() as { success: boolean; totalLines: number }

        expect(response.status).toBe(200)
        expect(body).toHaveProperty('success', true)
        expect(body).toHaveProperty('totalLines', 150)
        expect(applyFilePatches).toHaveBeenCalledWith('test-repo/test.ts', [
          { type: 'replace', startLine: 10, content: 'new line\n' },
        ])
      })

      it('should return error when patch application fails', async () => {
        applyFilePatches.mockRejectedValue(new Error('Invalid patch'))

        const response = await app.request('/api/files/test-repo/test.ts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patches: [{ type: 'replace' as const, startLine: 999 }],
          }),
        })
        const body = await response.json() as { error: string }

        expect(response.status).toBe(404)
        expect(body).toHaveProperty('error')
      })
    })

    describe('Rename/Move', () => {
      it('should rename file successfully', async () => {
        renameOrMoveFile.mockResolvedValue(mockRenameResult)

        const response = await app.request('/api/files/test-repo/old.ts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPath: 'test-repo/renamed.ts' }),
        })
        const body = await response.json() as FileInfo

        expect(response.status).toBe(200)
        expect(body).toHaveProperty('name', 'renamed.ts')
        expect(body).toHaveProperty('path', 'test-repo/renamed.ts')
        expect(renameOrMoveFile).toHaveBeenCalledWith('test-repo/old.ts', {
          newPath: 'test-repo/renamed.ts',
        })
      })

      it('should return error when rename fails', async () => {
        renameOrMoveFile.mockRejectedValue(new Error('File not found'))

        const response = await app.request('/api/files/test-repo/nonexistent.ts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPath: 'test-repo/new.ts' }),
        })
        const body = await response.json() as { error: string }

        expect(response.status).toBe(404)
        expect(body).toHaveProperty('error')
      })
    })
  })

  describe('Path Traversal Protection', () => {
    const mockFileInfo: FileInfo = {
      name: 'test.txt',
      path: 'safe-path/test.txt',
      isDirectory: false,
      size: 100,
      mimeType: 'text/plain',
      content: '',
      lastModified: new Date(),
    }

    it('should reject path with ../ segments via service error', async () => {
      getFile.mockRejectedValue({ message: 'Path traversal detected', statusCode: 403 })

      const response = await app.request('/api/files/../../../etc/passwd')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(403)
      expect(body.error).toContain('Path traversal detected')
    })

    it('should reject encoded path traversal attempts', async () => {
      getFile.mockRejectedValue({ message: 'Path traversal detected', statusCode: 403 })

      const response = await app.request('/api/files/test-repo/..%2Fetc')
      const body = await response.json() as { error: string }

      expect(response.status).toBe(403)
      expect(body.error).toContain('Path traversal detected')
    })
  })
})
