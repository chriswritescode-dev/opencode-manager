import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { LoggingConfig } from '../types'

const PREFIX = '[OpenCodeManagerMemory]'
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024

function ensureLogDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function checkFileSize(filePath: string): void {
  try {
    const stats = statSync(filePath)
    if (stats.size > MAX_LOG_FILE_SIZE) {
      const backupPath = filePath + '.old'
      renameSync(filePath, backupPath)
      writeFileSync(filePath, '', 'utf-8')
    }
  } catch {
    // File doesn't exist yet, ignore
  }
}

export function createLogger(config: LoggingConfig) {
  if (!config.enabled) {
    return {
      log: (_message: string, ..._args: unknown[]): void => {},
      error: (_message: string, ..._args: unknown[]): void => {},
    }
  }

  const filePath = config.file
  ensureLogDir(filePath)

  function write(level: string, message: string, args: unknown[]): void {
    checkFileSize(filePath)

    const timestamp = new Date().toISOString()
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => String(a)).join(' ') : ''
    const line = `${timestamp} ${level} ${PREFIX} ${message}${formattedArgs}\n`

    try {
      appendFileSync(filePath, line, 'utf-8')
    } catch {
      // Silently fail if logging fails - don't crash the plugin
    }
  }

  return {
    log: (message: string, ...args: unknown[]): void => {
      write('INFO', message, args)
    },
    error: (message: string, ...args: unknown[]): void => {
      write('ERROR', message, args)
    },
  }
}
