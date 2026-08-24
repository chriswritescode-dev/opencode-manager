import { describe, it, expect } from 'vitest'
import { getUploadItemsFromDataTransfer, getUploadItemsFromFileList } from './directoryUpload'

interface StubFileEntry {
  name: string
  isFile: true
  isDirectory: false
  file: (successCallback: (file: File) => void) => void
}

interface StubDirectoryEntry {
  name: string
  isFile: false
  isDirectory: true
  createReader: () => FileSystemDirectoryReader
}

function createFileEntry(name: string, content = 'content'): { entry: FileSystemFileEntry; readCount: () => number } {
  const file = new File([content], name)
  let readCount = 0
  const entry = {
    name,
    isFile: true,
    isDirectory: false,
    file: (successCallback: (file: File) => void) => {
      readCount++
      successCallback(file)
    },
  } as StubFileEntry as unknown as FileSystemFileEntry
  return { entry, readCount: () => readCount }
}

function createDirReader(children: FileSystemEntry[]): FileSystemDirectoryReader {
  let called = false
  return {
    readEntries: (successCallback: (entries: FileSystemEntry[]) => void) => {
      if (called) {
        successCallback([])
        return
      }
      called = true
      successCallback(children)
    },
  } as unknown as FileSystemDirectoryReader
}

function createDirectoryEntry(name: string, children: FileSystemEntry[]): { entry: FileSystemDirectoryEntry; readerCreated: () => number } {
  let readerCreated = 0
  const entry = {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      readerCreated++
      return createDirReader(children)
    },
  } as StubDirectoryEntry as unknown as FileSystemDirectoryEntry
  return { entry, readerCreated: () => readerCreated }
}

function createDataTransfer(entries: FileSystemEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: [],
  } as unknown as DataTransfer
}

describe('getUploadItemsFromDataTransfer', () => {
  it('preserves nested relative paths from a dropped directory tree', async () => {
    const a = createFileEntry('a.md')
    const b = createFileEntry('b.md')
    const sub = createDirectoryEntry('sub', [b.entry])
    const root = createDirectoryEntry('root', [a.entry, sub.entry])

    const items = await getUploadItemsFromDataTransfer(createDataTransfer([root.entry]))

    expect(items.map((item) => item.relativePath)).toEqual(['root/a.md', 'root/sub/b.md'])
    expect(items.map((item) => item.file.name)).toEqual(['a.md', 'b.md'])
  })

  it('prunes a skipped subtree without reading its files', async () => {
    const keep = createFileEntry('keep.md')
    const junk = createFileEntry('junk.js')
    const nodeModules = createDirectoryEntry('node_modules', [junk.entry])
    const root = createDirectoryEntry('root', [keep.entry, nodeModules.entry])

    const items = await getUploadItemsFromDataTransfer(createDataTransfer([root.entry]), {
      shouldSkip: (relativePath) => relativePath.split('/').includes('node_modules'),
    })

    expect(items.map((item) => item.relativePath)).toEqual(['root/keep.md'])
    expect(junk.readCount()).toBe(0)
    expect(nodeModules.readerCreated()).toBe(0)
  })
})

describe('getUploadItemsFromFileList', () => {
  it('uses webkitRelativePath when present', () => {
    const nested = new File(['a'], 'a.md')
    Object.defineProperty(nested, 'webkitRelativePath', { value: 'folder/a.md' })
    const plain = new File(['b'], 'b.md')

    const items = getUploadItemsFromFileList([nested, plain] as unknown as FileList)

    expect(items.map((item) => item.relativePath)).toEqual(['folder/a.md', 'b.md'])
    expect(items.map((item) => item.file)).toEqual([nested, plain])
  })
})
