import { accessSync, chmodSync, constants, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname } from 'path'
import { z } from 'zod'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

const NodeErrorSchema = z.object({ code: z.string().optional() })

function nodeErrorCode(cause: unknown): string | undefined {
  const error = NodeErrorSchema.safeParse(cause)
  return error.success ? error.data.code : undefined
}

function isPermissionError(cause: unknown): boolean {
  const code = nodeErrorCode(cause)
  return code === 'EACCES' || code === 'EPERM'
}

export function removeQuietly(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    return
  }
}

export function ensurePrivateDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE })
  } catch (cause) {
    if (!isPermissionError(cause)) throw cause
    try {
      accessSync(dir, constants.X_OK)
    } catch {
      throw cause
    }
  }
  try {
    chmodSync(dir, DIR_MODE)
  } catch {
    return
  }
}

export function readJsonFile<Schema extends z.ZodType>(filePath: string, schema: Schema): z.infer<Schema> | null {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf-8')
  } catch (cause) {
    if (nodeErrorCode(cause) === 'ENOENT') return null
    throw cause
  }
  if (contents.trim() === '') return null
  try {
    const parsed = schema.safeParse(JSON.parse(contents))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeJsonFileAtomic<T>(filePath: string, data: T): void {
  ensurePrivateDir(dirname(filePath))
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: FILE_MODE, flag: 'wx' })
    chmodSync(tmp, FILE_MODE)
    renameSync(tmp, filePath)
  } catch (cause) {
    removeQuietly(tmp)
    throw cause
  }
}
