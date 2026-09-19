import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'fs/promises'
import path from 'path'
import { FILE_LIMITS, getReposPath } from '@opencode-manager/shared/config/env'
import {
  applyFilePatches,
  createFileOrFolder,
  deleteFileOrFolder,
  getFile,
  getFileRange,
  getRawFileContent,
  renameOrMoveFile,
  uploadFile,
} from '../../src/services/files'

const reposPath = getReposPath()

let tempRoot: string
let relativeRoot: string

function resolveTempPath(relativePath: string): string {
  return path.join(reposPath, relativePath)
}

async function writeLines(relativePath: string, content: string): Promise<string> {
  const absolutePath = resolveTempPath(relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return absolutePath
}

async function readLines(relativePath: string): Promise<string> {
  return readFile(resolveTempPath(relativePath), 'utf8')
}

beforeAll(async () => {
  await mkdir(reposPath, { recursive: true })
})

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(reposPath, 'files-test-'))
  relativeRoot = path.basename(tempRoot)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('files service', () => {
  describe('getRawFileContent', () => {
    it('returns the raw buffer for an existing file', async () => {
      await writeLines(`${relativeRoot}/raw.txt`, 'raw content')

      const buffer = await getRawFileContent(`${relativeRoot}/raw.txt`)

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString('utf8')).toBe('raw content')
    })

    it('rejects with 404 when the file is missing', async () => {
      await expect(getRawFileContent(`${relativeRoot}/missing.txt`)).rejects.toEqual({
        message: 'File not found or cannot be read',
        statusCode: 404,
      })
    })

    it('rejects with 404 when the path is a directory', async () => {
      await mkdir(resolveTempPath(`${relativeRoot}/dir`))

      await expect(getRawFileContent(`${relativeRoot}/dir`)).rejects.toEqual({
        message: 'File not found or cannot be read',
        statusCode: 404,
      })
    })
  })

  describe('getFile', () => {
    it('returns base64 content for a text file', async () => {
      await writeLines(`${relativeRoot}/note.txt`, 'hello world')

      const result = await getFile(`${relativeRoot}/note.txt`)

      expect(result.isDirectory).toBe(false)
      expect(result.name).toBe('note.txt')
      expect(result.path).toBe(`${relativeRoot}/note.txt`)
      expect(result.mimeType).toBe('text/plain')
      expect(result.size).toBe(11)
      expect(Buffer.from(result.content ?? '', 'base64').toString('utf8')).toBe('hello world')
    })

    it('returns base64 content for an image file', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      await writeFile(resolveTempPath(`${relativeRoot}/image.png`), bytes)

      const result = await getFile(`${relativeRoot}/image.png`)

      expect(result.mimeType).toBe('image/png')
      expect(result.content).toBe(bytes.toString('base64'))
    })

    it('returns base64 content for an unknown text extension', async () => {
      await writeLines(`${relativeRoot}/data.unknownext`, 'mystery')

      const result = await getFile(`${relativeRoot}/data.unknownext`)

      expect(result.mimeType).toBe('text/plain')
      expect(Buffer.from(result.content ?? '', 'base64').toString('utf8')).toBe('mystery')
    })

    it('omits content for files at the size limit', async () => {
      const filePath = await writeLines(`${relativeRoot}/large.txt`, '')
      await truncate(filePath, FILE_LIMITS.MAX_SIZE_BYTES)

      const result = await getFile(`${relativeRoot}/large.txt`)

      expect(result.size).toBe(FILE_LIMITS.MAX_SIZE_BYTES)
      expect(result.content).toBe('')
    })

    it('lists directories first then files sorted by name', async () => {
      await mkdir(resolveTempPath(`${relativeRoot}/zdir`))
      await mkdir(resolveTempPath(`${relativeRoot}/adir`))
      await writeLines(`${relativeRoot}/b.txt`, 'b')
      await writeLines(`${relativeRoot}/a.txt`, 'a')

      const result = await getFile(relativeRoot)

      expect(result.isDirectory).toBe(true)
      expect(result.path).toBe(relativeRoot)
      expect(result.workspaceRoot).toBe(reposPath)
      expect(result.children?.map((child) => child.name)).toEqual(['adir', 'zdir', 'a.txt', 'b.txt'])
      expect(result.children?.map((child) => child.isDirectory)).toEqual([true, true, false, false])
    })

    it('rejects with 404 when the path is missing', async () => {
      await expect(getFile(`${relativeRoot}/missing.txt`)).rejects.toEqual({
        message: 'File or directory not found',
        statusCode: 404,
      })
    })
  })

  describe('uploadFile', () => {
    it('writes a file and returns its metadata', async () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

      const result = await uploadFile(relativeRoot, file)

      expect(result).toEqual({
        name: 'hello.txt',
        path: path.join(relativeRoot, 'hello.txt'),
        size: 5,
        mimeType: 'text/plain',
      })
      expect(await readLines(`${relativeRoot}/hello.txt`)).toBe('hello')
    })

    it('derives the mime type from the file name when type is empty', async () => {
      const file = new File(['markdown'], 'notes.md')

      const result = await uploadFile(relativeRoot, file)

      expect(result.mimeType).toBe('text/markdown')
      expect(await readLines(`${relativeRoot}/notes.md`)).toBe('markdown')
    })

    it('writes to a nested relative path', async () => {
      const file = new File(['nested'], 'deep.txt', { type: 'text/plain' })

      const result = await uploadFile(relativeRoot, file, 'nested/deep.txt')

      expect(result.path).toBe(path.join(relativeRoot, 'nested/deep.txt'))
      expect(await readLines(`${relativeRoot}/nested/deep.txt`)).toBe('nested')
    })

    it('rejects files larger than the upload limit', async () => {
      const file = {
        name: 'oversized.txt',
        type: 'text/plain',
        size: FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES + 1,
      } as unknown as File

      await expect(uploadFile(relativeRoot, file)).rejects.toThrow('File too large')
    })

    it('rejects disallowed mime types', async () => {
      const file = new File(['binary'], 'payload.exe', { type: 'application/octet-stream' })

      await expect(uploadFile(relativeRoot, file)).rejects.toThrow('File type not allowed')
    })

    it('rejects a relative path that resolves elsewhere', async () => {
      const file = new File(['escape'], 'escape.txt', { type: 'text/plain' })

      await expect(uploadFile(`${relativeRoot} `, file)).rejects.toEqual({
        message: 'Invalid relative path',
        statusCode: 400,
      })
    })
  })

  describe('createFileOrFolder', () => {
    it('creates a folder', async () => {
      const result = await createFileOrFolder(`${relativeRoot}/new-folder`, { type: 'folder' })

      expect(result.isDirectory).toBe(true)
      expect(result.name).toBe('new-folder')
      expect(result.path).toBe(`${relativeRoot}/new-folder`)
      expect((await getFile(`${relativeRoot}/new-folder`)).isDirectory).toBe(true)
    })

    it('creates a file with content', async () => {
      const result = await createFileOrFolder(`${relativeRoot}/created.txt`, {
        type: 'file',
        content: 'created',
      })

      expect(result.isDirectory).toBe(false)
      expect(result.size).toBe(7)
      expect(await readLines(`${relativeRoot}/created.txt`)).toBe('created')
    })

    it('creates an empty file when no content is given', async () => {
      const result = await createFileOrFolder(`${relativeRoot}/empty.txt`, { type: 'file' })

      expect(result.size).toBe(0)
      expect(await readLines(`${relativeRoot}/empty.txt`)).toBe('')
    })
  })

  describe('deleteFileOrFolder', () => {
    it('deletes a file', async () => {
      await writeLines(`${relativeRoot}/remove.txt`, 'remove me')

      await deleteFileOrFolder(`${relativeRoot}/remove.txt`)

      await expect(getFile(`${relativeRoot}/remove.txt`)).rejects.toEqual({
        message: 'File or directory not found',
        statusCode: 404,
      })
    })

    it('deletes a directory recursively', async () => {
      await writeLines(`${relativeRoot}/nested/remove.txt`, 'remove me')

      await deleteFileOrFolder(`${relativeRoot}/nested`)

      await expect(getFile(`${relativeRoot}/nested`)).rejects.toEqual({
        message: 'File or directory not found',
        statusCode: 404,
      })
    })
  })

  describe('renameOrMoveFile', () => {
    it('moves a file into a new parent directory', async () => {
      await writeLines(`${relativeRoot}/old.txt`, 'moved')

      const result = await renameOrMoveFile(`${relativeRoot}/old.txt`, {
        newPath: `${relativeRoot}/new-parent/new.txt`,
      })

      expect(result.name).toBe('new.txt')
      expect(result.path).toBe(`${relativeRoot}/new-parent/new.txt`)
      expect(result.isDirectory).toBe(false)
      expect(await readLines(`${relativeRoot}/new-parent/new.txt`)).toBe('moved')
    })
  })

  describe('getFileRange', () => {
    beforeEach(async () => {
      await writeLines(`${relativeRoot}/lines.txt`, 'l1\nl2\nl3\nl4\nl5')
    })

    it('returns a middle range with hasMore', async () => {
      const result = await getFileRange(`${relativeRoot}/lines.txt`, 1, 3)

      expect(result.lines).toEqual(['l2', 'l3'])
      expect(result.totalLines).toBe(5)
      expect(result.startLine).toBe(1)
      expect(result.endLine).toBe(3)
      expect(result.hasMore).toBe(true)
      expect(result.isDirectory).toBe(false)
    })

    it('clamps the end line and reports no more lines', async () => {
      const result = await getFileRange(`${relativeRoot}/lines.txt`, 2, 100)

      expect(result.lines).toEqual(['l3', 'l4', 'l5'])
      expect(result.endLine).toBe(5)
      expect(result.hasMore).toBe(false)
    })

    it('rejects with 404 when the file is missing', async () => {
      await expect(getFileRange(`${relativeRoot}/missing.txt`, 0, 5)).rejects.toEqual({
        message: 'File does not exist',
        statusCode: 404,
      })
    })

    it('rejects with 400 when the path is a directory', async () => {
      await expect(getFileRange(relativeRoot, 0, 5)).rejects.toEqual({
        message: 'Path is a directory',
        statusCode: 400,
      })
    })
  })

  describe('applyFilePatches', () => {
    it('replaces a line range', async () => {
      await writeLines(`${relativeRoot}/replace.txt`, 'a\nb\nc\nd')

      const result = await applyFilePatches(`${relativeRoot}/replace.txt`, [
        { type: 'replace', startLine: 1, endLine: 3, content: 'B' },
      ])

      expect(result).toEqual({ success: true, totalLines: 3 })
      expect(await readLines(`${relativeRoot}/replace.txt`)).toBe('a\nB\nd')
    })

    it('replaces a single line when endLine is omitted', async () => {
      await writeLines(`${relativeRoot}/replace-one.txt`, 'a\nb\nc')

      const result = await applyFilePatches(`${relativeRoot}/replace-one.txt`, [
        { type: 'replace', startLine: 1, content: 'X' },
      ])

      expect(result).toEqual({ success: true, totalLines: 3 })
      expect(await readLines(`${relativeRoot}/replace-one.txt`)).toBe('a\nX\nc')
    })

    it('inserts content at a line', async () => {
      await writeLines(`${relativeRoot}/insert.txt`, 'a\nb')

      const result = await applyFilePatches(`${relativeRoot}/insert.txt`, [
        { type: 'insert', startLine: 1, content: 'X\nY' },
      ])

      expect(result).toEqual({ success: true, totalLines: 4 })
      expect(await readLines(`${relativeRoot}/insert.txt`)).toBe('a\nX\nY\nb')
    })

    it('inserts nothing when content is omitted', async () => {
      await writeLines(`${relativeRoot}/insert-empty.txt`, 'a\nb')

      const result = await applyFilePatches(`${relativeRoot}/insert-empty.txt`, [
        { type: 'insert', startLine: 0 },
      ])

      expect(result).toEqual({ success: true, totalLines: 2 })
      expect(await readLines(`${relativeRoot}/insert-empty.txt`)).toBe('a\nb')
    })

    it('deletes a line range', async () => {
      await writeLines(`${relativeRoot}/delete.txt`, 'a\nb\nc\nd')

      const result = await applyFilePatches(`${relativeRoot}/delete.txt`, [
        { type: 'delete', startLine: 1, endLine: 3 },
      ])

      expect(result).toEqual({ success: true, totalLines: 2 })
      expect(await readLines(`${relativeRoot}/delete.txt`)).toBe('a\nd')
    })

    it('deletes a single line when endLine is omitted', async () => {
      await writeLines(`${relativeRoot}/delete-one.txt`, 'a\nb\nc')

      const result = await applyFilePatches(`${relativeRoot}/delete-one.txt`, [
        { type: 'delete', startLine: 1 },
      ])

      expect(result).toEqual({ success: true, totalLines: 2 })
      expect(await readLines(`${relativeRoot}/delete-one.txt`)).toBe('a\nc')
    })

    it('rejects with 404 when the file is missing', async () => {
      await expect(
        applyFilePatches(`${relativeRoot}/missing.txt`, [
          { type: 'replace', startLine: 0, content: 'x' },
        ]),
      ).rejects.toEqual({
        message: 'File does not exist',
        statusCode: 404,
      })
    })
  })

  describe('path traversal protection', () => {
    it('rejects traversal in getFile', async () => {
      await expect(getFile('../../etc/passwd')).rejects.toEqual({
        message: 'Path traversal detected',
        statusCode: 403,
      })
    })

    it('rejects traversal in getRawFileContent', async () => {
      await expect(getRawFileContent('../../etc/passwd')).rejects.toEqual({
        message: 'Path traversal detected',
        statusCode: 403,
      })
    })

    it('rejects traversal in createFileOrFolder', async () => {
      await expect(createFileOrFolder('../../escape', { type: 'folder' })).rejects.toEqual({
        message: 'Path traversal detected',
        statusCode: 403,
      })
    })

    it('rejects traversal in applyFilePatches', async () => {
      await expect(
        applyFilePatches('../../escape.txt', [{ type: 'replace', startLine: 0, content: 'x' }]),
      ).rejects.toEqual({
        message: 'Path traversal detected',
        statusCode: 403,
      })
    })
  })
})
