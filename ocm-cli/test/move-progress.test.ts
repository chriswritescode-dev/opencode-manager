import { describe, it, expect } from 'vitest'
import { renderProgressBar, formatMoveProgress, pushPhaseProgress, replayProgress } from '../src/move-progress'

describe('renderProgressBar', () => {
  it('fills proportionally and reports a percentage', () => {
    expect(renderProgressBar(0, 10)).toBe('░░░░░░░░░░ 0%')
    expect(renderProgressBar(0.5, 10)).toBe('█████░░░░░ 50%')
    expect(renderProgressBar(1, 10)).toBe('██████████ 100%')
  })

  it('clamps out-of-range fractions', () => {
    expect(renderProgressBar(-1, 4)).toBe('░░░░ 0%')
    expect(renderProgressBar(7, 4)).toBe('████ 100%')
  })
})

describe('formatMoveProgress', () => {
  it('shows spinner frame and label without a bar for indeterminate phases', () => {
    expect(formatMoveProgress({ label: 'creating git bundle', fraction: null }, 0)).toBe('⠋ ocm-move: creating git bundle')
  })

  it('appends a bar for determinate phases and cycles spinner frames', () => {
    const text = formatMoveProgress({ label: 'uploading', fraction: 0.25 }, 11)
    expect(text.startsWith('⠙ ocm-move: uploading ')).toBe(true)
    expect(text.endsWith(' 25%')).toBe(true)
  })
})

describe('phase mapping', () => {
  it('maps upload bytes to a fraction', () => {
    expect(pushPhaseProgress({ kind: 'uploading', bytesSent: 512, totalBytes: 2048 })).toEqual({ label: 'uploading 512 B / 2.0 KB', fraction: 0.25 })
  })

  it('treats a zero-byte upload as indeterminate', () => {
    expect(pushPhaseProgress({ kind: 'uploading', bytesSent: 0, totalBytes: 0 }).fraction).toBeNull()
  })

  it('maps server phases to indeterminate labels', () => {
    expect(pushPhaseProgress({ kind: 'bundling' })).toEqual({ label: 'creating git bundle', fraction: null })
    expect(pushPhaseProgress({ kind: 'processing' })).toEqual({ label: 'server importing bundle', fraction: null })
    expect(pushPhaseProgress({ kind: 'patching' })).toEqual({ label: 'applying local changes', fraction: null })
  })

  it('maps replay counts to a fraction', () => {
    expect(replayProgress(3, 12)).toEqual({ label: 'replaying session 3/12 events', fraction: 0.25 })
    expect(replayProgress(0, 0).fraction).toBeNull()
  })
})
