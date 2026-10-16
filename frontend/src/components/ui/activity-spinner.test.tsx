import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivitySpinner, SPINNER_FRAMES, brailleDots } from './activity-spinner'

const circles = (root: ParentNode) => Array.from(root.querySelectorAll('circle'))

const litIndexes = (root: ParentNode) =>
  circles(root)
    .map((circle, index) => (circle.getAttribute('fill-opacity') === '1' ? index : -1))
    .filter((index) => index >= 0)

const litIndexesFor = (frame: string) =>
  brailleDots(frame)
    .map((lit, index) => (lit ? index : -1))
    .filter((index) => index >= 0)

describe('brailleDots', () => {
  it('lights dots 1, 2 and 4 for the first frame', () => {
    expect(brailleDots('⠋')).toEqual([true, true, false, true, false, false, false, false])
  })

  it('lights dots 1 through 4 for the last frame', () => {
    expect(brailleDots('⠏')).toEqual([true, true, true, true, false, false, false, false])
  })
})

describe('ActivitySpinner', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders eight dots with the first frame lit and hidden from assistive technology', () => {
    const { container } = render(<ActivitySpinner />)

    expect(circles(container)).toHaveLength(8)
    expect(litIndexes(container)).toEqual(litIndexesFor(SPINNER_FRAMES[0]))
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('steps every dot through all frames in order with a discrete, endless 80ms-per-frame animation', () => {
    const { container } = render(<ActivitySpinner />)

    circles(container).forEach((circle, dotIndex) => {
      const animate = circle.querySelector('animate')
      expect(animate).toHaveAttribute('attributeName', 'fill-opacity')
      expect(animate).toHaveAttribute('calcMode', 'discrete')
      expect(animate).toHaveAttribute('repeatCount', 'indefinite')
      expect(animate).toHaveAttribute('dur', `${80 * SPINNER_FRAMES.length}ms`)

      const values = animate?.getAttribute('values')?.split(';')
      expect(values).toEqual(SPINNER_FRAMES.map((frame) => (brailleDots(frame)[dotIndex] ? '1' : '0.25')))
    })
  })

  it('schedules no JavaScript timers however many spinners are mounted', () => {
    vi.useFakeTimers()

    render(
      <>
        <ActivitySpinner />
        <ActivitySpinner />
        <ActivitySpinner />
      </>,
    )

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps every dot inside the cell and clear of its neighbours', () => {
    const { container } = render(<ActivitySpinner />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 9 16')

    const dots = circles(container).map((circle) => ({
      cx: Number(circle.getAttribute('cx')),
      cy: Number(circle.getAttribute('cy')),
      r: Number(circle.getAttribute('r')),
    }))

    expect(dots).toHaveLength(8)

    for (const dot of dots) {
      expect(dot.cx - dot.r).toBeGreaterThan(0)
      expect(dot.cx + dot.r).toBeLessThan(9)
      expect(dot.cy - dot.r).toBeGreaterThan(0)
      expect(dot.cy + dot.r).toBeLessThan(16)
    }

    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const distance = Math.hypot(dots[i].cx - dots[j].cx, dots[i].cy - dots[j].cy)
        expect(distance).toBeGreaterThanOrEqual(dots[i].r + dots[j].r)
      }
    }
  })
})
