import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { DEFAULTS } from '@opencode-manager/shared/config'
import type {
  ManagerLogEntry,
  ManagerLogLevel,
  ManagerLogQuery,
  ManagerLogSource,
  ManagerLogsResponse,
} from '@opencode-manager/shared/schemas'

const instanceId = randomUUID()
const entries: ManagerLogEntry[] = []
let nextSeq = 1
let dropped = 0

const LEVEL_SEVERITY: Record<ManagerLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const TRUNCATION_SUFFIX = ' …[truncated]'

export function stringifyLogArg(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function composeLogMessage(prefix: string, message: string, args: unknown[]): string {
  const prefixed = prefix ? `[${prefix}] ${message}` : message
  if (args.length === 0) {
    return prefixed
  }
  return [prefixed, ...args.map(stringifyLogArg)].join(' ')
}

export function appendManagerLogEntry(input: {
  level: ManagerLogLevel
  source: ManagerLogSource
  message: string
}): void {
  const message =
    input.message.length > DEFAULTS.LOGS.MAX_ENTRY_LENGTH
      ? input.message.slice(0, DEFAULTS.LOGS.MAX_ENTRY_LENGTH) + TRUNCATION_SUFFIX
      : input.message

  entries.push({
    seq: nextSeq++,
    timestamp: new Date().toISOString(),
    level: input.level,
    source: input.source,
    message,
  })

  while (entries.length > DEFAULTS.LOGS.BUFFER_CAPACITY) {
    entries.shift()
    dropped++
  }
}

const PROCESS_LOG_LEVEL_PATTERN = /^\s*\[?(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i

export function parseProcessLogLevel(line: string, fallback: ManagerLogLevel): ManagerLogLevel {
  const match = line.match(PROCESS_LOG_LEVEL_PATTERN)
  if (!match) {
    return fallback
  }
  const token = match[1]?.toLowerCase() ?? ''
  if (token === 'warning') {
    return 'warn'
  }
  if (token === 'fatal') {
    return 'error'
  }
  if (token === 'debug' || token === 'info' || token === 'warn' || token === 'error') {
    return token
  }
  return fallback
}

export function createProcessLogForwarder(options: {
  source: ManagerLogSource
  defaultLevel: ManagerLogLevel
}): { write: (chunk: Uint8Array | string) => void; flush: () => void } {
  const decoder = new StringDecoder('utf8')
  let remainder = ''

  const appendLine = (line: string) => {
    if (line.trimEnd().length === 0) {
      return
    }
    appendManagerLogEntry({
      source: options.source,
      level: parseProcessLogLevel(line, options.defaultLevel),
      message: line,
    })
  }

  const appendDecodedText = (text: string) => {
    const parts = (remainder + text).split(/\r?\n/)
    remainder = parts.pop() ?? ''
    for (const part of parts) {
      appendLine(part)
    }
    if (remainder.length > DEFAULTS.LOGS.MAX_ENTRY_LENGTH) {
      appendLine(remainder)
      remainder = ''
    }
  }

  return {
    write(chunk: Uint8Array | string): void {
      appendDecodedText(decoder.write(chunk))
    },
    flush(): void {
      remainder += decoder.end()
      if (remainder.length === 0) {
        return
      }
      appendLine(remainder)
      remainder = ''
    },
  }
}

export function readManagerLogEntries(query: ManagerLogQuery): ManagerLogsResponse {
  const afterSeq = query.afterSeq ?? 0
  const hasCursor = query.afterSeq !== undefined
  const minSeverity = query.level ? LEVEL_SEVERITY[query.level] : undefined

  const matched = entries.filter((entry) => {
    if (entry.seq <= afterSeq) {
      return false
    }
    if (minSeverity !== undefined && LEVEL_SEVERITY[entry.level] < minSeverity) {
      return false
    }
    if (query.source && entry.source !== query.source) {
      return false
    }
    return true
  })

  const limit = Math.min(query.limit ?? DEFAULTS.LOGS.DEFAULT_PAGE_SIZE, DEFAULTS.LOGS.MAX_PAGE_SIZE)
  const page = hasCursor
    ? matched.slice(0, limit)
    : limit < matched.length
      ? matched.slice(matched.length - limit)
      : matched

  return {
    entries: page,
    instanceId,
    latestSeq: nextSeq - 1,
    oldestSeq: entries[0]?.seq ?? 0,
    dropped,
    capacity: DEFAULTS.LOGS.BUFFER_CAPACITY,
  }
}

export function resetManagerLogBuffer(): void {
  entries.length = 0
  nextSeq = 1
  dropped = 0
}
