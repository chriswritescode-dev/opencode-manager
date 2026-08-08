const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export interface ProgressSink {
  write(chunk: string): void
  isTTY?: boolean
}

export interface ProgressReporter {
  tick(bytes: number): void
  done(): void
}

export function createProgressReporter(
  label: string,
  out: ProgressSink = process.stderr,
  now: () => number = Date.now,
): ProgressReporter {
  let finished = false
  let lastRenderAt = -Infinity
  let lastNonTtyTickAt = -Infinity
  let frameIndex = 0
  const isTTY = out.isTTY === true

  return {
    tick(bytes: number): void {
      if (finished) return
      const t = now()

      if (isTTY) {
        if (t - lastRenderAt < 80) return
        lastRenderAt = t
        out.write(`\r\x1b[K${label}: ${FRAMES[frameIndex]} ${formatBytes(bytes)}`)
        frameIndex = (frameIndex + 1) % FRAMES.length
      } else {
        if (t - lastNonTtyTickAt < 1000) return
        lastNonTtyTickAt = t
        out.write(`${label}: ${formatBytes(bytes)}\n`)
      }
    },

    done(): void {
      if (finished) return
      finished = true
      if (isTTY) {
        out.write('\r\x1b[K')
      }
    },
  }
}
