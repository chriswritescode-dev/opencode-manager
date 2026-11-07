import { OUTPUT_LIMITS, OutputFrameMessageSchema } from '@opencode-manager/shared/schemas'
import type { OutputFrameMessage } from '@opencode-manager/shared/schemas'

const OUTPUT_THEME_TOKENS = [
  '--color-background',
  '--color-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-border',
  '--color-primary',
  '--color-primary-foreground',
  '--color-accent',
  '--color-diff-add',
  '--color-diff-delete',
] as const

/** Reads the current theme's output-related CSS custom properties from the document root. */
export function readOutputThemeTokens(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    OUTPUT_THEME_TOKENS.map((token) => [token, styles.getPropertyValue(token).trim()]),
  )
}

/** Validates a frame message against the expected source window and payload schema. */
export function parseFrameMessage(
  event: MessageEvent,
  frameWindow: Window | null,
): OutputFrameMessage | null {
  if (!frameWindow || event.source !== frameWindow) return null
  const result = OutputFrameMessageSchema.safeParse(event.data)
  return result.success ? result.data : null
}

/** Rounds a frame-requested height into the supported range. */
export function clampFrameHeight(height: number): number {
  return Math.min(
    OUTPUT_LIMITS.FRAME_MAX_HEIGHT,
    Math.max(OUTPUT_LIMITS.FRAME_MIN_HEIGHT, Math.round(height)),
  )
}
