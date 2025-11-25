import { ENV } from '../config'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

class Logger {
  private prefix: string

  constructor(prefix: string = '') {
    this.prefix = prefix
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString()
    const prefixStr = this.prefix ? `[${this.prefix}] ` : ''
    return `[${timestamp}] [${level.toUpperCase()}] ${prefixStr}${message}`
  }

  info(message: string, ...args: unknown[]): void {
    console.log(this.format('info', message), ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.format('warn', message), ...args)
  }

  error(message: string, ...args: unknown[]): void {
    console.error(this.format('error', message), ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    if (ENV.LOGGING.DEBUG) {
      console.debug(this.format('debug', message), ...args)
    }
  }
}

export const logger = new Logger()
