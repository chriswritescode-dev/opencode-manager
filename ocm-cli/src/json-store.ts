import { accessSync, chmodSync, constants, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname } from 'path'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
}

function removeQuietly(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    return
  }
}

export function ensurePrivateDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE })
  } catch (err) {
    if (!isPermissionError(err)) throw err
    try {
      accessSync(dir, constants.X_OK)
    } catch {
      throw err
    }
  }
  try {
    chmodSync(dir, DIR_MODE)
  } catch {
    return
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (contents.trim() === '') return null
  try {
    return JSON.parse(contents) as T
  } catch {
    return null
  }
}

export function writeJsonFileAtomic(filePath: string, data: unknown): void {
  ensurePrivateDir(dirname(filePath))
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: FILE_MODE, flag: 'wx' })
    chmodSync(tmp, FILE_MODE)
    renameSync(tmp, filePath)
  } catch (err) {
    removeQuietly(tmp)
    throw err
  }
}
