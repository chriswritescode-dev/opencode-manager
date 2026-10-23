/** Storage key under which a device persists the pause-before-sending duration. */
export const VOICE_PAUSE_STORAGE_KEY = 'voice.pauseBeforeSendingMs'

/**
 * Pause durations, in milliseconds, offered by the pause-before-sending picker.
 * A stored or requested value outside this list is treated as absent.
 */
export const VOICE_PAUSE_OPTIONS_MS = [800, 1200, 1600, 2000, 3000] as const

/**
 * Pause duration applied before the first stored value is hydrated, and the
 * value persisted when storage holds nothing usable.
 */
export const DEFAULT_VOICE_PAUSE_MS = 1200

/**
 * Fixed silence timeout, in milliseconds, that ends a hands-free voice turn.
 * Not user-adjustable and therefore independent of the pause preference.
 */
export const VOICE_NO_SPEECH_TIMEOUT_MS = 10_000

/**
 * Reports whether `value` is one of the selectable pause durations.
 *
 * @param value Candidate pause duration in milliseconds.
 * @returns Whether the value is offered by the pause-before-sending picker.
 */
export function isVoicePauseOption(value: number): boolean {
  return (VOICE_PAUSE_OPTIONS_MS as readonly number[]).includes(value)
}

/**
 * Parses a stored pause duration. A value that is not one of
 * {@link VOICE_PAUSE_OPTIONS_MS} is treated as absent, so the caller keeps
 * {@link DEFAULT_VOICE_PAUSE_MS}.
 *
 * @param raw The stored string.
 * @returns The pause duration in milliseconds, or undefined when it is unusable.
 */
export function parseVoicePauseMs(raw: string): number | undefined {
  const ms = Number(raw)
  return isVoicePauseOption(ms) ? ms : undefined
}

/**
 * Normalizes a requested pause duration. A value that is not one of
 * {@link VOICE_PAUSE_OPTIONS_MS} is rejected instead of being clamped.
 *
 * @param ms Requested pause duration in milliseconds.
 * @returns The pause duration in milliseconds, or undefined when it is unusable.
 */
export function normalizeVoicePauseMs(ms: number): number | undefined {
  return isVoicePauseOption(ms) ? ms : undefined
}

/**
 * Formats a pause duration as the one-decimal seconds label used by the
 * pause-before-sending picker and the settings row.
 *
 * @param ms Pause duration in milliseconds.
 * @returns The label, for example `"1.2 s"` for 1200 milliseconds.
 */
export function formatVoicePauseMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}
