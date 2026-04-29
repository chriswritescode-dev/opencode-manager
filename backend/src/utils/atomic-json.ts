import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { logger } from './logger'

const fileLockPromises = new Map<string, Promise<unknown>>()

export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }
    logger.warn(`Failed to read or parse JSON from ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  try {
    await fs.mkdir(filePath.substring(0, filePath.lastIndexOf('/')), { recursive: true })
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw error
  }
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const absolutePath = filePath
  const previousLock = fileLockPromises.get(absolutePath)

  const executeWithLock = async (): Promise<T> => {
    try {
      return await fn()
    } finally {
      if (fileLockPromises.get(absolutePath) === newLock) {
        fileLockPromises.delete(absolutePath)
      }
    }
  }

  const newLock = previousLock ? previousLock.then(executeWithLock) : executeWithLock()
  fileLockPromises.set(absolutePath, newLock)

  return newLock as Promise<T>
}
