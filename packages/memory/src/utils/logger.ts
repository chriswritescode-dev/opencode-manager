import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { LoggingConfig } from '../types'

const PREFIX = '[OpenCodeManagerMemory]'
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50)
}

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
  const isEnabled = config.enabled
  const isDebug = config.debug ?? false

  if (!isEnabled) {
    return {
      log: (_message: string, ..._args: unknown[]): void => {},
      error: (_message: string, ..._args: unknown[]): void => {},
      debug: (_message: string, ..._args: unknown[]): void => {},
    }
  }

  const filePath = config.file
  ensureLogDir(filePath)

  function formatArg(arg: unknown): string {
    if (arg === null) return 'null'
    if (arg === undefined) return 'undefined'
    if (arg instanceof Error) {
      return arg.stack ?? `${arg.name}: ${arg.message}`
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  }

  function write(level: string, message: string, args: unknown[]): void {
    checkFileSize(filePath)

    const timestamp = new Date().toISOString()
    const formattedArgs = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : ''
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
    debug: isDebug
      ? (message: string, ...args: unknown[]): void => {
          write('DEBUG', message, args)
        }
      : (_message: string, ..._args: unknown[]): void => {},
  }
}
