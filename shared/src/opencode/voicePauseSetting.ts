export const VOICE_PAUSE_STORAGE_KEY = 'voice.pauseBeforeSendingMs'

export const VOICE_PAUSE_OPTIONS_MS = [800, 1200, 1600, 2000, 3000] as const

export const DEFAULT_VOICE_PAUSE_MS = 1200

export const VOICE_NO_SPEECH_TIMEOUT_MS = 10_000

const VOICE_PAUSE_OPTION_SET: ReadonlySet<number> = new Set(VOICE_PAUSE_OPTIONS_MS)

export function isVoicePauseOption(value: number): boolean {
  return VOICE_PAUSE_OPTION_SET.has(value)
}

export function parseVoicePauseMs(raw: string): number | undefined {
  const ms = Number(raw)
  return isVoicePauseOption(ms) ? ms : undefined
}

export function normalizeVoicePauseMs(ms: number): number | undefined {
  return isVoicePauseOption(ms) ? ms : undefined
}

export function formatVoicePauseMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}
