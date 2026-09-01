import type { MirrorUpFastPhase } from './mirror.js'
import { formatBytes, SPINNER_FRAMES } from './progress.js'

export interface MoveProgress {
  label: string
  fraction: number | null
}

const BAR_WIDTH = 12

export function renderProgressBar(fraction: number, width = BAR_WIDTH): string {
  const clamped = Math.min(1, Math.max(0, fraction))
  const filled = Math.round(clamped * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(clamped * 100)}%`
}

export function formatMoveProgress(progress: MoveProgress, frame: number): string {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
  const bar = progress.fraction === null ? '' : ` ${renderProgressBar(progress.fraction)}`
  return `${spinner} ocm-move: ${progress.label}${bar}`
}

export function pushPhaseProgress(phase: MirrorUpFastPhase): MoveProgress {
  switch (phase.kind) {
    case 'bundling':
      return { label: 'creating git bundle', fraction: null }
    case 'uploading':
      return {
        label: `uploading ${formatBytes(phase.bytesSent)} / ${formatBytes(phase.totalBytes)}`,
        fraction: phase.totalBytes > 0 ? phase.bytesSent / phase.totalBytes : null,
      }
    case 'processing':
      return { label: 'server importing bundle', fraction: null }
    case 'patching':
      return { label: 'applying local changes', fraction: null }
  }
}

export function replayProgress(replayed: number, total: number): MoveProgress {
  return { label: `replaying session ${replayed}/${total} events`, fraction: total > 0 ? replayed / total : null }
}
