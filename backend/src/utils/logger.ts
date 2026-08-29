import { ENV } from '@opencode-manager/shared/config/env'
import { appendManagerLogEntry, composeLogMessage } from './log-buffer'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

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
    write(this.format(level, composed))
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
    if (ENV.LOGGING.DEBUG) {
      this.emit('debug', (line) => console.debug(line), message, args)
    }
  }
}

export const logger = new Logger()
