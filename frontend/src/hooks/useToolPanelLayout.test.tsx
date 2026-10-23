import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  MAIN_CONTENT_MIN_WIDTH,
  TOOL_PANEL_MAX_WIDTH,
  TOOL_PANEL_MIN_WIDTH,
  TOOL_PANEL_RAIL_WIDTH,
  clampToolPanelWidth,
  maximumToolPanelWidth,
  useToolPanelLayout,
  useToolPanelWidth,
} from './useToolPanelLayout'

const originalInnerWidth = window.innerWidth

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function stubPageWidth(width: number): () => void {
  const main = document.createElement('main')
  main.getBoundingClientRect = () =>
    ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  document.body.append(main)
  return () => main.remove()
}

describe('clampToolPanelWidth', () => {
  it('keeps the requested width when there is room for it', () => {
    expect(clampToolPanelWidth(600, 1440)).toBe(600)
  })

  it('clamps to the panel maximum and minimum', () => {
    expect(clampToolPanelWidth(900, 1440)).toBe(TOOL_PANEL_MAX_WIDTH)
    expect(clampToolPanelWidth(100, 1440)).toBe(TOOL_PANEL_MIN_WIDTH)
  })

  it('never takes room from the main column', () => {
    const availableWidth = 900
    const maximum = availableWidth - TOOL_PANEL_RAIL_WIDTH - MAIN_CONTENT_MIN_WIDTH

    expect(maximumToolPanelWidth(availableWidth)).toBe(maximum)
    expect(clampToolPanelWidth(600, availableWidth)).toBe(maximum)
  })
})

describe('useToolPanelLayout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setViewportWidth(originalInnerWidth)
  })

  it('docks when the page has room for the rail, the panel and the main column', () => {
    const removePage = stubPageWidth(1200)

    const { result } = renderHook(() => useToolPanelLayout())
    removePage()

    expect(result.current).toEqual({ docked: true, showRail: true })
  })

  it('keeps the rail and switches the panel to an overlay when docking would squeeze the main column', () => {
    const removePage = stubPageWidth(560)

    const { result } = renderHook(() => useToolPanelLayout())
    removePage()

    expect(result.current).toEqual({ docked: false, showRail: true })
  })

  it('hides the rail on a mobile viewport', () => {
    setViewportWidth(390)

    const { result } = renderHook(() => useToolPanelLayout())

    expect(result.current).toEqual({ docked: false, showRail: false })
  })
})

describe('useToolPanelWidth', () => {
  beforeEach(() => {
    localStorage.clear()
    setViewportWidth(1440)
  })

  afterEach(() => {
    setViewportWidth(originalInnerWidth)
  })

  it('persists a resized width and restores it', () => {
    const first = renderHook(() => useToolPanelWidth())

    act(() => {
      first.result.current.setWidth(480)
    })

    expect(first.result.current.width).toBe(480)
    expect(localStorage.getItem('oc:tool-panel:width')).toBe('480')
    first.unmount()

    const second = renderHook(() => useToolPanelWidth())

    expect(second.result.current.width).toBe(480)
  })

  it('clamps the stored width to the space the page has', () => {
    setViewportWidth(900)
    const { result } = renderHook(() => useToolPanelWidth())

    expect(result.current.width).toBe(maximumToolPanelWidth(900))
  })
})
