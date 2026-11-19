import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { z, type ZodType } from 'zod'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { logger } from './logger'
import { getErrorMessage } from './error-utils'
import { mkdirSafe } from './fs-safe'

const fileLockPromises = new Map<string, Promise<unknown>>()

type JsonLike = JsonValue | undefined | { readonly [key: string]: JsonLike } | readonly JsonLike[]

export async function readJsonSafe<Schema extends ZodType>(
  filePath: string,
  schema: Schema,
  fallback: z.infer<Schema>,
): Promise<z.infer<Schema>> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = schema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : fallback
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return fallback
    }
    logger.warn(`Failed to read or parse JSON from ${filePath}: ${getErrorMessage(cause)}`)
    return fallback
  }
}

export async function writeJsonAtomic(filePath: string, data: JsonLike): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  try {
    await mkdirSafe(filePath.substring(0, filePath.lastIndexOf('/')))
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

  const newLock = previousLock ? previousLock.then(executeWithLock, executeWithLock) : executeWithLock()
  fileLockPromises.set(absolutePath, newLock)

  return newLock
}
