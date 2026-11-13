import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Mock } from 'vitest'
import {
  ChunkedFileInfoSchema,
  FileInfoSchema,
  FileUploadResponseSchema,
} from '@opencode-manager/shared/schemas'
import type { FileInfo, FilePatchRequest } from '@opencode-manager/shared'
import { createFileRoutes } from '../../src/routes/files'
import type { FileArchiveRoutesService, FileRoutesService } from '../../src/routes/files'
import type { RawFileMetadata } from '../../src/services/files'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })
const SuccessResponseSchema = z.object({ success: z.literal(true) })
const PatchResultSchema = z.object({ success: z.boolean(), totalLines: z.number() })

interface FileServiceFakes {
  getFile: Mock<FileRoutesService['getFile']>
  getRawFileContent: Mock<FileRoutesService['getRawFileContent']>
  getRawFileMetadata: Mock<FileRoutesService['getRawFileMetadata']>
  getFileRange: Mock<FileRoutesService['getFileRange']>
  uploadFile: Mock<FileRoutesService['uploadFile']>
  createFileOrFolder: Mock<FileRoutesService['createFileOrFolder']>
  deleteFileOrFolder: Mock<FileRoutesService['deleteFileOrFolder']>
  renameOrMoveFile: Mock<FileRoutesService['renameOrMoveFile']>
  applyFilePatches: Mock<FileRoutesService['applyFilePatches']>
}

interface ArchiveServiceFakes {
  createDirectoryArchive: Mock<FileArchiveRoutesService['createDirectoryArchive']>
  getArchiveSize: Mock<FileArchiveRoutesService['getArchiveSize']>
  getArchiveStream: Mock<FileArchiveRoutesService['getArchiveStream']>
  deleteArchive: Mock<FileArchiveRoutesService['deleteArchive']>
  getIgnoredPathsList: Mock<FileArchiveRoutesService['getIgnoredPathsList']>
}

function createFileServiceFakes(): FileServiceFakes {
  return {
    getFile: vi.fn<FileRoutesService['getFile']>(),
    getRawFileContent: vi.fn<FileRoutesService['getRawFileContent']>(),
    getRawFileMetadata: vi.fn<FileRoutesService['getRawFileMetadata']>(),
    getFileRange: vi.fn<FileRoutesService['getFileRange']>(),
    uploadFile: vi.fn<FileRoutesService['uploadFile']>(),
    createFileOrFolder: vi.fn<FileRoutesService['createFileOrFolder']>(),
    deleteFileOrFolder: vi.fn<FileRoutesService['deleteFileOrFolder']>(),
    renameOrMoveFile: vi.fn<FileRoutesService['renameOrMoveFile']>(),
    applyFilePatches: vi.fn<FileRoutesService['applyFilePatches']>(),
  }
}

function createArchiveServiceFakes(): ArchiveServiceFakes {
  return {
    createDirectoryArchive: vi.fn<FileArchiveRoutesService['createDirectoryArchive']>(),
    getArchiveSize: vi.fn<FileArchiveRoutesService['getArchiveSize']>(),
    getArchiveStream: vi.fn<FileArchiveRoutesService['getArchiveStream']>(),
    deleteArchive: vi.fn<FileArchiveRoutesService['deleteArchive']>(),
    getIgnoredPathsList: vi.fn<FileArchiveRoutesService['getIgnoredPathsList']>(),
  }
}

const fileInfo: FileInfo = {
  name: 'test.txt',
  path: 'test-repo/test.txt',
  isDirectory: false,
  size: 100,
  mimeType: 'text/plain',
  content: Buffer.from('test content').toString('base64'),
  lastModified: new Date(),
}

const directoryInfo: FileInfo = {
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

const rawLastModified = new Date('2024-01-02T03:04:05.000Z')
const rawEtag = `W/"13-${rawLastModified.getTime()}"`
const rawMetadata = { size: 13, mimeType: 'text/html', lastModified: rawLastModified } satisfies RawFileMetadata
const rawContent = Buffer.from('<h1>hi</h1>\n\n')

describe('file routes', () => {
  let app: Hono
  let files: FileServiceFakes
  let archives: ArchiveServiceFakes
  let tempDir: string

  beforeEach(() => {
    files = createFileServiceFakes()
    archives = createArchiveServiceFakes()
    app = new Hono()
    app.route('/api/files', createFileRoutes(files, archives))
    tempDir = mkdtempSync(path.join(tmpdir(), 'ocm-file-routes-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('GET /:path/download-zip', () => {
    it('streams a directory archive instead of the file route', async () => {
      const archivePath = path.join(tempDir, 'test-repo-src.zip')
      writeFileSync(archivePath, 'zip-bytes')
      archives.createDirectoryArchive.mockResolvedValue(archivePath)
      archives.getArchiveSize.mockResolvedValue(9)
      archives.getArchiveStream.mockImplementation(() => createReadStream(archivePath))

      const response = await app.request('/api/files/test-repo/src/download-zip')

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/zip')
      expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="src.zip"')
      expect(response.headers.get('Content-Length')).toBe('9')
      expect(await response.text()).toBe('zip-bytes')
      expect(files.getFile).not.toHaveBeenCalled()
      expect(archives.createDirectoryArchive).toHaveBeenCalledWith('test-repo/src', undefined, {
        includeGit: false,
        includePaths: undefined,
      })
      await vi.waitFor(() => expect(archives.deleteArchive).toHaveBeenCalledWith(archivePath))
    })

    it('returns 400 when no path is provided', async () => {
      const response = await app.request('/api/files/download-zip')
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('No path provided')
      expect(archives.createDirectoryArchive).not.toHaveBeenCalled()
    })

    it('returns 500 when archive creation fails', async () => {
      archives.createDirectoryArchive.mockRejectedValue(new Error('Directory not found'))

      const response = await app.request('/api/files/non-repo/download-zip')
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(500)
      expect(body.error).toBe('Directory not found')
    })
  })

  describe('GET /:path', () => {
    it('returns a directory listing', async () => {
      files.getFile.mockResolvedValue(directoryInfo)

      const response = await app.request('/api/files/test-repo/src')
      const body = await readJson(response, FileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.isDirectory).toBe(true)
      expect(body.children?.map((child) => child.name)).toEqual(['file.ts'])
    })

    it('returns file info when no query params are set', async () => {
      files.getFile.mockResolvedValue(fileInfo)

      const response = await app.request('/api/files/test-repo/test.txt')
      const body = await readJson(response, FileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.isDirectory).toBe(false)
      expect(body.content).toBe(fileInfo.content)
    })

    it.each(['test-repo/report.html', 'test-repo/report.htm'])(
      'serves %s raw inside a CSP sandbox',
      async (requestPath) => {
        files.getRawFileMetadata.mockResolvedValue(rawMetadata)
        files.getRawFileContent.mockResolvedValue(rawContent)

        const response = await app.request(`/api/files?path=${requestPath}&raw=true`)

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/html')
        expect(response.headers.get('Content-Security-Policy')).toBe('sandbox allow-scripts')
        expect(response.headers.get('Cache-Control')).toBe('no-cache')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(await response.text()).toBe('<h1>hi</h1>\n\n')
        expect(files.getFile).not.toHaveBeenCalled()
      },
    )

    it('includes ETag and Last-Modified on raw responses', async () => {
      files.getRawFileMetadata.mockResolvedValue(rawMetadata)
      files.getRawFileContent.mockResolvedValue(rawContent)

      const response = await app.request('/api/files?path=test-repo/report.html&raw=true')

      expect(response.headers.get('ETag')).toBe(rawEtag)
      expect(response.headers.get('Last-Modified')).toBe(rawLastModified.toUTCString())
      expect(response.headers.get('Content-Length')).toBe('13')
    })

    it.each([
      { label: 'the exact ETag', header: rawEtag },
      { label: 'a comma-separated list', header: `"other", ${rawEtag}` },
      { label: 'the wildcard', header: '*' },
    ])('returns 304 without a body when If-None-Match matches $label', async ({ header }) => {
      files.getRawFileMetadata.mockResolvedValue(rawMetadata)

      const response = await app.request('/api/files?path=test-repo/report.html&raw=true', {
        headers: { 'If-None-Match': header },
      })

      expect(response.status).toBe(304)
      expect(response.headers.get('ETag')).toBe(rawEtag)
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(await response.text()).toBe('')
      expect(files.getRawFileContent).not.toHaveBeenCalled()
    })

    it('returns 200 when If-None-Match does not match', async () => {
      files.getRawFileMetadata.mockResolvedValue(rawMetadata)
      files.getRawFileContent.mockResolvedValue(rawContent)

      const response = await app.request('/api/files?path=test-repo/report.html&raw=true', {
        headers: { 'If-None-Match': 'W/"different"' },
      })

      expect(response.status).toBe(200)
      expect(files.getRawFileContent).toHaveBeenCalled()
    })

    it('falls through to the directory listing when raw is requested for a directory', async () => {
      files.getRawFileMetadata.mockResolvedValue(null)
      files.getFile.mockResolvedValue(directoryInfo)

      const response = await app.request('/api/files?path=test-repo/src&raw=true')
      const body = await readJson(response, FileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.isDirectory).toBe(true)
      expect(files.getRawFileContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the path does not exist', async () => {
      files.getFile.mockRejectedValue({ message: 'File or directory not found', statusCode: 404 })

      const response = await app.request('/api/files/test-repo/nonexistent.txt')
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(404)
      expect(body.error).toBe('File or directory not found')
    })

    it.each(['test-repo/../etc/passwd', 'test-repo/..%2Fetc'])(
      'returns the service path traversal rejection for %s',
      async (requestPath) => {
        files.getFile.mockRejectedValue({ message: 'Path traversal detected', statusCode: 403 })

        const response = await app.request(`/api/files/${requestPath}`)
        const body = await readJson(response, ErrorResponseSchema)

        expect(response.status).toBe(403)
        expect(body.error).toContain('Path traversal detected')
      },
    )
  })

  describe('GET /:path?startLine&endLine', () => {
    it('returns the requested file range', async () => {
      files.getFileRange.mockResolvedValue({
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
      })

      const response = await app.request('/api/files/test-repo/test.ts?startLine=5&endLine=10')
      const body = await readJson(response, ChunkedFileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.startLine).toBe(5)
      expect(body.endLine).toBe(10)
      expect(body.totalLines).toBe(100)
      expect(body.lines).toHaveLength(5)
    })

    it.each([
      { label: 'a non-numeric startLine', query: 'startLine=invalid&endLine=10' },
      { label: 'a non-numeric endLine', query: 'startLine=0&endLine=invalid' },
      { label: 'an endLine equal to startLine', query: 'startLine=10&endLine=10' },
      { label: 'a negative startLine', query: 'startLine=-5&endLine=10' },
    ])('returns 400 for $label', async ({ query }) => {
      const response = await app.request(`/api/files/test-repo/test.ts?${query}`)
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('Invalid line range parameters')
      expect(files.getFileRange).not.toHaveBeenCalled()
    })
  })

  describe('POST /:path', () => {
    it('uploads a file', async () => {
      files.uploadFile.mockResolvedValue({
        name: 'test.txt',
        path: 'test-repo/test.txt',
        size: 100,
        mimeType: 'text/plain',
      })
      const formData = new FormData()
      formData.append('file', new File(['content'], 'test.txt', { type: 'text/plain' }))

      const response = await app.request('/api/files/test-repo', { method: 'POST', body: formData })
      const body = await readJson(response, FileUploadResponseSchema)

      expect(response.status).toBe(200)
      expect(body.name).toBe('test.txt')
      expect(body.path).toBe('test-repo/test.txt')
    })

    it('returns 400 when no file is provided', async () => {
      const response = await app.request('/api/files/test-repo', { method: 'POST', body: new FormData() })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(400)
      expect(body.error).toBe('No file provided')
      expect(files.uploadFile).not.toHaveBeenCalled()
    })

    it('maps an upload failure to its status code', async () => {
      files.uploadFile.mockRejectedValue(new Error('File too large'))
      const formData = new FormData()
      formData.append('file', new File(['content'], 'large.bin', { type: 'application/octet-stream' }))

      const response = await app.request('/api/files/test-repo', { method: 'POST', body: formData })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(500)
      expect(body.error).toBe('File too large')
    })
  })

  describe('PUT /:path', () => {
    const createCases = [
      {
        label: 'a file',
        body: { type: 'file', content: 'export const x = 1' },
        result: {
          name: 'newfile.ts',
          path: 'test-repo/newfile.ts',
          isDirectory: false,
          size: 50,
          lastModified: new Date(),
        },
      },
      {
        label: 'a folder',
        body: { type: 'folder' },
        result: {
          name: 'newfolder',
          path: 'test-repo/newfolder',
          isDirectory: true,
          size: 0,
          lastModified: new Date(),
        },
      },
    ] satisfies { label: string; body: { type: 'file' | 'folder'; content?: string }; result: FileInfo }[]

    it.each(createCases)('creates $label', async ({ body: requestBody, result }) => {
      files.createFileOrFolder.mockResolvedValue(result)

      const response = await app.request(`/api/files/${result.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const body = await readJson(response, FileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.path).toBe(result.path)
      expect(body.isDirectory).toBe(result.isDirectory)
    })

    it('returns 500 when creation fails', async () => {
      files.createFileOrFolder.mockRejectedValue(new Error('Permission denied'))

      const response = await app.request('/api/files/test-repo/newfile.ts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file' }),
      })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(500)
      expect(body.error).toBe('Permission denied')
    })
  })

  describe('DELETE /:path', () => {
    it.each(['test-repo/oldfile.ts', 'test-repo/oldfolder'])('deletes %s', async (requestPath) => {
      files.deleteFileOrFolder.mockResolvedValue(undefined)

      const response = await app.request(`/api/files/${requestPath}`, { method: 'DELETE' })
      const body = await readJson(response, SuccessResponseSchema)

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(files.deleteFileOrFolder).toHaveBeenCalledWith(requestPath)
    })

    it('maps a deletion failure to its status code', async () => {
      files.deleteFileOrFolder.mockRejectedValue({ message: 'File not found', statusCode: 404 })

      const response = await app.request('/api/files/test-repo/nonexistent.ts', { method: 'DELETE' })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(404)
      expect(body.error).toBe('File not found')
    })
  })

  describe('PATCH /:path', () => {
    it('applies patches', async () => {
      files.applyFilePatches.mockResolvedValue({ success: true, totalLines: 150 })
      const requestBody: FilePatchRequest = {
        patches: [{ type: 'replace', startLine: 10, content: 'new line\n' }],
      }

      const response = await app.request('/api/files/test-repo/test.ts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const body = await readJson(response, PatchResultSchema)

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.totalLines).toBe(150)
      expect(files.applyFilePatches).toHaveBeenCalledWith('test-repo/test.ts', requestBody.patches)
    })

    it('maps a patch failure to its status code', async () => {
      files.applyFilePatches.mockRejectedValue({ message: 'Invalid patch', statusCode: 404 })
      const requestBody: FilePatchRequest = {
        patches: [{ type: 'replace', startLine: 999 }],
      }

      const response = await app.request('/api/files/test-repo/test.ts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(404)
      expect(body.error).toBe('Invalid patch')
    })

    it('renames a file when no patches are present', async () => {
      files.renameOrMoveFile.mockResolvedValue({
        name: 'renamed.ts',
        path: 'test-repo/renamed.ts',
        isDirectory: false,
        size: 200,
        lastModified: new Date(),
      })

      const response = await app.request('/api/files/test-repo/old.ts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath: 'test-repo/renamed.ts' }),
      })
      const body = await readJson(response, FileInfoSchema)

      expect(response.status).toBe(200)
      expect(body.name).toBe('renamed.ts')
      expect(body.path).toBe('test-repo/renamed.ts')
      expect(files.renameOrMoveFile).toHaveBeenCalledWith('test-repo/old.ts', { newPath: 'test-repo/renamed.ts' })
    })

    it('maps a rename failure to its status code', async () => {
      files.renameOrMoveFile.mockRejectedValue({ message: 'File not found', statusCode: 404 })

      const response = await app.request('/api/files/test-repo/nonexistent.ts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath: 'test-repo/new.ts' }),
      })
      const body = await readJson(response, ErrorResponseSchema)

      expect(response.status).toBe(404)
      expect(body.error).toBe('File not found')
    })
  })
})
