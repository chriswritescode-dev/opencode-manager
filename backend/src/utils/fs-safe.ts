import path from 'path'
import { promises as fs, mkdirSync, accessSync, constants } from 'node:fs'

interface MkdirSafeOptions {
  mode?: number
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
}

export async function writeFileAtomic(filePath: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdirSafe(dir)
  const tempPath = path.join(dir, `.${path.basename(filePath)}.ocm-tmp-${process.pid}-${Date.now()}`)
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: options.mode ?? 0o600 })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function mkdirSafe(dirPath: string, options: MkdirSafeOptions = {}): Promise<void> {
  try {
    await fs.mkdir(dirPath, { ...options, recursive: true })
  } catch (error) {
    if (!isPermissionError(error)) throw error
    try {
      await fs.access(dirPath, constants.X_OK)
    } catch {
      throw error
    }
  }
}

export function mkdirSyncSafe(dirPath: string, options: MkdirSafeOptions = {}): void {
  try {
    mkdirSync(dirPath, { ...options, recursive: true })
  } catch (error) {
    if (!isPermissionError(error)) throw error
    try {
      accessSync(dirPath, constants.X_OK)
    } catch {
      throw error
    }
  }
}
