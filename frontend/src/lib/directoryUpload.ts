import type { InputHTMLAttributes } from 'react'

export interface DirectoryUploadItem {
  file: File
  relativePath: string
}

export const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: '',
  directory: '',
  mozdirectory: '',
} as InputHTMLAttributes<HTMLInputElement>

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

export async function traverseFileSystemEntry(
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

    for (const childEntry of entries) {
      const childItems = await traverseFileSystemEntry(childEntry, relativePath, shouldSkip)
      items.push(...childItems)
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
