import { promises as fs, mkdirSync, accessSync, constants } from 'node:fs'

interface MkdirSafeOptions {
  mode?: number
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
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
