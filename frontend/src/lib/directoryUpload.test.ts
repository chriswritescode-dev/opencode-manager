import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEvent } from 'react'
import { isExcludedOpenCodeConfigUploadPath } from '@opencode-manager/shared/utils'
import {
  getUploadItemsFromDataTransfer,
  getUploadItemsFromFileList,
  useDirectoryDropZone,
  type DirectoryUploadItem,
} from './directoryUpload'

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

function createBatchedDirReader(batches: FileSystemEntry[][]): FileSystemDirectoryReader {
  let index = 0
  return {
    readEntries: (successCallback: (entries: FileSystemEntry[]) => void) => {
      successCallback(index < batches.length ? batches[index++] : [])
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

function createBatchedDirectoryEntry(name: string, batches: FileSystemEntry[][]): { entry: FileSystemDirectoryEntry; readerCreated: () => number } {
  let readerCreated = 0
  const entry = {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      readerCreated++
      return createBatchedDirReader(batches)
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

  it('returns the complete file set across readEntries batches while pruning skipped subtrees', async () => {
    const files: FileSystemEntry[] = []
    const expectedPaths: string[] = []
    for (let i = 0; i < 120; i++) {
      const file = createFileEntry(`file${i}.md`)
      files.push(file.entry)
      expectedPaths.push(`root/file${i}.md`)
    }
    const junk = createFileEntry('junk.js')
    const nodeModules = createDirectoryEntry('node_modules', [junk.entry])
    const root = createBatchedDirectoryEntry('root', [files.slice(0, 100), files.slice(100), [nodeModules.entry]])

    const items = await getUploadItemsFromDataTransfer(createDataTransfer([root.entry]), {
      shouldSkip: (relativePath) => relativePath.split('/').includes('node_modules'),
    })

    expect(items.map((item) => item.relativePath)).toEqual(expectedPaths)
    expect(items).toHaveLength(120)
    expect(junk.readCount()).toBe(0)
    expect(nodeModules.readerCreated()).toBe(0)
  })
})

describe('useDirectoryDropZone', () => {
  function dropOnZone(handlers: ReturnType<typeof useDirectoryDropZone>['dropHandlers'], entries: FileSystemEntry[]) {
    return act(async () => {
      await handlers.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: createDataTransfer(entries),
      } as unknown as DragEvent)
    })
  }

  it('passes the traversed items to onItems without applying skips, as the file browser consumes it', async () => {
    const onItems = vi.fn()
    const { result } = renderHook(() => useDirectoryDropZone({ onItems }))
    const keep = createFileEntry('keep.md')
    const junk = createFileEntry('junk.js')
    const nodeModules = createDirectoryEntry('node_modules', [junk.entry])
    const root = createDirectoryEntry('root', [keep.entry, nodeModules.entry])

    await dropOnZone(result.current.dropHandlers, [root.entry])

    expect(onItems).toHaveBeenCalledTimes(1)
    const items = onItems.mock.calls[0][0] as DirectoryUploadItem[]
    expect(items.map((item) => item.relativePath)).toEqual(['root/keep.md', 'root/node_modules/junk.js'])
  })

  it('applies the shouldSkip filter for the config-directory consumer', async () => {
    const onItems = vi.fn()
    const { result } = renderHook(() =>
      useDirectoryDropZone({
        shouldSkip: (relativePath) => isExcludedOpenCodeConfigUploadPath(relativePath),
        onItems,
      }),
    )
    const keep = createFileEntry('keep.md')
    const junk = createFileEntry('junk.js')
    const dotGit = createFileEntry('config')
    const nodeModules = createDirectoryEntry('node_modules', [junk.entry])
    const gitDir = createDirectoryEntry('.git', [dotGit.entry])
    const root = createDirectoryEntry('root', [keep.entry, nodeModules.entry, gitDir.entry])

    await dropOnZone(result.current.dropHandlers, [root.entry])

    expect(onItems).toHaveBeenCalledTimes(1)
    const items = onItems.mock.calls[0][0] as DirectoryUploadItem[]
    expect(items.map((item) => item.relativePath)).toEqual(['root/keep.md'])
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
