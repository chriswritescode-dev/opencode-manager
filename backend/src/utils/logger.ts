import { ManagerLogLevelSchema, type ManagerLogLevel } from '@opencode-manager/shared/schemas'
import { appendManagerLogEntry, composeLogMessage } from './log-buffer'

type LogLevel = ManagerLogLevel

const LEVEL_SEVERITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} satisfies Record<LogLevel, number>

function envBoolean(key: string): boolean {
  const value = process.env[key]
  return value === 'true' || value === '1'
}

function resolveConsoleLevel(): LogLevel {
  const configured = ManagerLogLevelSchema.safeParse(process.env.LOG_LEVEL)
  return configured.success ? configured.data : 'info'
}

class Logger {
  private prefix: string

  constructor(prefix: string = '') {
    this.prefix = prefix
  }

  private format(level: LogLevel, composed: string): string {
    return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${composed}`
  }

  private emit(
    level: LogLevel,
    write: (line: string) => void,
    message: string,
    args: unknown[],
  ): void {
    const composed = composeLogMessage(this.prefix, message, args)
    if (level === 'debug' || LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[resolveConsoleLevel()]) {
      write(this.format(level, composed))
    }
    appendManagerLogEntry({ level, source: 'manager', message: composed })
  }

  info(message: string, ...args: unknown[]): void {
    this.emit('info', (line) => console.log(line), message, args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.emit('warn', (line) => console.warn(line), message, args)
  }

  error(message: string, ...args: unknown[]): void {
    this.emit('error', (line) => console.error(line), message, args)
  }

  debug(message: string, ...args: unknown[]): void {
    if (envBoolean('DEBUG')) {
      this.emit('debug', (line) => console.debug(line), message, args)
    }
  }
}

export const logger = new Logger()
