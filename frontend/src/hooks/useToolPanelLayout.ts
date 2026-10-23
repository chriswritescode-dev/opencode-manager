import { useCallback, useLayoutEffect, useState } from 'react'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'
import { useMobile } from './useMobile'

export const TOOL_PANEL_MIN_WIDTH = 320
export const TOOL_PANEL_MAX_WIDTH = 720
export const TOOL_PANEL_DEFAULT_WIDTH = 600
export const TOOL_PANEL_ACTIVITY_WIDTH = 320
export const TOOL_PANEL_RAIL_WIDTH = 44
export const MAIN_CONTENT_MIN_WIDTH = 420

const WIDTH_STORAGE_KEY = 'oc:tool-panel:width'

function viewportWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth
}

function readAvailableWidth(): number {
  const measured = document.querySelector('main')?.getBoundingClientRect().width ?? 0
  return measured > 0 ? measured : viewportWidth()
}

/** Width of the page area beside the navigation sidebar, which is where the tool panel docks. */
export function useAvailableToolPanelWidth(): number {
  const [width, setWidth] = useState(readAvailableWidth)

  useLayoutEffect(() => {
    const update = () => setWidth(readAvailableWidth())
    update()
    window.addEventListener('resize', update)
    const main = document.querySelector('main')
    if (!main || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(main)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return width
}

export function maximumToolPanelWidth(availableWidth: number): number {
  const room = availableWidth - TOOL_PANEL_RAIL_WIDTH - MAIN_CONTENT_MIN_WIDTH
  return Math.max(TOOL_PANEL_MIN_WIDTH, Math.min(TOOL_PANEL_MAX_WIDTH, room))
}

export function clampToolPanelWidth(width: number, availableWidth: number): number {
  const maximum = maximumToolPanelWidth(availableWidth)
  return Math.min(maximum, Math.max(TOOL_PANEL_MIN_WIDTH, Math.round(width)))
}

function readStoredToolPanelWidth(): number | null {
  const stored = readStoredValue(WIDTH_STORAGE_KEY)
  if (stored === null) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface ToolPanelWidthState {
  width: number
  minWidth: number
  maxWidth: number
  setWidth: (width: number) => void
}

/**
 * The docked tool panel's width, persisted under `oc:tool-panel:width` and clamped so the main
 * column keeps at least `MAIN_CONTENT_MIN_WIDTH` pixels.
 */
export function useToolPanelWidth(preferredWidth: number = TOOL_PANEL_DEFAULT_WIDTH): ToolPanelWidthState {
  const availableWidth = useAvailableToolPanelWidth()
  const [storedWidth, setStoredWidth] = useState<number | null>(readStoredToolPanelWidth)

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampToolPanelWidth(next, availableWidth)
      writeStoredValue(WIDTH_STORAGE_KEY, clamped)
      setStoredWidth(clamped)
    },
    [availableWidth],
  )

  return {
    width: clampToolPanelWidth(storedWidth ?? preferredWidth, availableWidth),
    minWidth: TOOL_PANEL_MIN_WIDTH,
    maxWidth: maximumToolPanelWidth(availableWidth),
    setWidth,
  }
}

export interface ToolPanelLayout {
  /** The tool panel docks beside the page; otherwise its tools open as overlay sheets. */
  docked: boolean
  /** The tool rail has room to stay on screen, also when the panel opens as an overlay. */
  showRail: boolean
}

/**
 * Layout of the route's tool rail and panel. Docking needs room for the rail, a usable panel
 * and a usable main column; below that the rail stays and the tools open as overlay sheets.
 */
export function useToolPanelLayout(): ToolPanelLayout {
  const isMobile = useMobile()
  const availableWidth = useAvailableToolPanelWidth()
  const usableWidth = availableWidth - TOOL_PANEL_RAIL_WIDTH
  return {
    docked: !isMobile && usableWidth >= MAIN_CONTENT_MIN_WIDTH + TOOL_PANEL_MIN_WIDTH,
    showRail: !isMobile,
  }
}
