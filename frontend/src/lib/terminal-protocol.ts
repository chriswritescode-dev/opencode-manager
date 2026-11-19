import { parseJsonText } from '@opencode-manager/shared/utils'
import { z } from 'zod'

const META_FRAME_PREFIX = 0x00

const MetaFrameSchema = z.looseObject({ cursor: z.number() })

const CTRL_SYMBOLS = new Map<string, string>([
  ['@', '\x00'],
  ['[', '\x1b'],
  ['\\', '\x1c'],
  [']', '\x1d'],
  ['^', '\x1e'],
  ['_', '\x1f'],
])

function isBinaryFrame(data: string | ArrayBuffer): data is ArrayBuffer {
  return Object.prototype.toString.call(data) === '[object ArrayBuffer]'
}

export type TerminalFrame =
  | { type: 'output'; text: string }
  | { type: 'cursor'; cursor: number }

export class TerminalFrameDecoder {
  private readonly decoder = new TextDecoder('utf-8')

  decode(data: string | ArrayBuffer): TerminalFrame {
    if (!isBinaryFrame(data)) {
      return { type: 'output', text: data }
    }

    const bytes = new Uint8Array(data)
    if (bytes.length > 0 && bytes[0] === META_FRAME_PREFIX) {
      return this.decodeMetaFrame(bytes.subarray(1))
    }

    return { type: 'output', text: this.decoder.decode(bytes, { stream: true }) }
  }

  private decodeMetaFrame(payload: Uint8Array): TerminalFrame {
    try {
      const parsed = MetaFrameSchema.safeParse(
        parseJsonText(new TextDecoder('utf-8').decode(payload)),
      )
      if (parsed.success && Number.isSafeInteger(parsed.data.cursor)) {
        return { type: 'cursor', cursor: parsed.data.cursor }
      }
    } catch {
      return { type: 'output', text: '' }
    }
    return { type: 'output', text: '' }
  }
}

export function applyCtrlModifier(data: string): string {
  if (data.length !== 1) return data

  const upper = data.toUpperCase()
  if (upper >= 'A' && upper <= 'Z') {
    return String.fromCharCode(upper.charCodeAt(0) - 64)
  }

  return CTRL_SYMBOLS.get(data) ?? data
}
