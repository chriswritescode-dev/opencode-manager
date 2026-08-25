import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, InputHTMLAttributes, RefObject } from 'react'

export interface DirectoryUploadItem {
  file: File
  relativePath: string
}

export const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: '',
  directory: '',
  mozdirectory: '',
} as InputHTMLAttributes<HTMLInputElement>

const DIRECTORY_TRAVERSAL_CONCURRENCY = 25

async function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function readDirectoryEntries(dirReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    dirReader.readEntries(resolve, reject)
  })
}

async function traverseFileSystemEntry(
  entry: FileSystemEntry,
  basePath: string = '',
  shouldSkip?: (relativePath: string, isDirectory: boolean) => boolean,
): Promise<DirectoryUploadItem[]> {
  const items: DirectoryUploadItem[] = []
  const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

  if (entry.isFile) {
    if (shouldSkip?.(relativePath, false)) return items
    const fileEntry = entry as FileSystemFileEntry
    const file = await readFileEntry(fileEntry)
    items.push({ file, relativePath })
  } else if (entry.isDirectory) {
    if (shouldSkip?.(relativePath, true)) return items
    const dirEntry = entry as FileSystemDirectoryEntry
    const dirReader = dirEntry.createReader()
    let entries: FileSystemEntry[] = []
    let batch: FileSystemEntry[]

    do {
      batch = await readDirectoryEntries(dirReader)
      entries = entries.concat(batch)
    } while (batch.length > 0)

    for (let i = 0; i < entries.length; i += DIRECTORY_TRAVERSAL_CONCURRENCY) {
      const childBatch = entries.slice(i, i + DIRECTORY_TRAVERSAL_CONCURRENCY)
      const childBatchItems = await Promise.all(
        childBatch.map((childEntry) => traverseFileSystemEntry(childEntry, relativePath, shouldSkip)),
      )
      for (const childItems of childBatchItems) {
        items.push(...childItems)
      }
    }
  }

  return items
}

export async function getUploadItemsFromDataTransfer(
  dataTransfer: DataTransfer,
  options?: { shouldSkip?: (relativePath: string, isDirectory: boolean) => boolean },
): Promise<DirectoryUploadItem[]> {
  const items: DirectoryUploadItem[] = []
  const entries: FileSystemEntry[] = []
  const shouldSkip = options?.shouldSkip

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i]
    const entry = item.webkitGetAsEntry?.()
    if (entry) {
      entries.push(entry)
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      const entryItems = await traverseFileSystemEntry(entry, '', shouldSkip)
      items.push(...entryItems)
    }
  } else {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i]
      items.push({ file, relativePath: file.name })
    }
  }

  return items
}

export function getUploadItemsFromFileList(fileList: FileList): DirectoryUploadItem[] {
  const items: DirectoryUploadItem[] = []
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    items.push({ file, relativePath })
  }
  return items
}

export function openPicker(inputRef: RefObject<HTMLInputElement | null>): void {
  requestAnimationFrame(() => inputRef.current?.click())
}

export function readUploadItemsFromInput(event: ChangeEvent<HTMLInputElement>): DirectoryUploadItem[] {
  const fileList = event.target.files
  const items = fileList ? getUploadItemsFromFileList(fileList) : []
  event.target.value = ''
  return items
}

interface DirectoryDropZoneOptions {
  shouldSkip?: (relativePath: string, isDirectory: boolean) => boolean
  onItems: (items: DirectoryUploadItem[]) => void | Promise<void>
}

export function useDirectoryDropZone(options: DirectoryDropZoneOptions) {
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const { shouldSkip, onItems } = options

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const items = await getUploadItemsFromDataTransfer(e.dataTransfer, shouldSkip ? { shouldSkip } : undefined)
    await onItems(items)
  }

  return {
    dropZoneRef,
    isDragging,
    dropHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
}
