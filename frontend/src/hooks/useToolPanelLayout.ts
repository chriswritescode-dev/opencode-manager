import { useCallback, useLayoutEffect, useState } from 'react'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'
import { useMobile } from './useMobile'

export const TOOL_PANEL_MIN_WIDTH = 320
export const TOOL_PANEL_MAX_WIDTH = 720
export const TOOL_PANEL_DEFAULT_WIDTH = 600
export const TOOL_PANEL_RAIL_WIDTH = 44
export const MAIN_CONTENT_MIN_WIDTH = 420

const WIDTH_STORAGE_KEY = 'oc:tool-panel:width'

function viewportWidth(): number {
  return 'window' in globalThis ? window.innerWidth : 0
}

function readAvailableWidth(): number {
  const measured = document.querySelector('main')?.getBoundingClientRect().width ?? 0
  return measured > 0 ? measured : viewportWidth()
}

export function useAvailableToolPanelWidth(): number {
  const [width, setWidth] = useState(readAvailableWidth)

  useLayoutEffect(() => {
    const update = () => setWidth(readAvailableWidth())
    update()
    window.addEventListener('resize', update)
    const main = document.querySelector('main')
    if (!main || !('ResizeObserver' in globalThis)) {
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

const widthStorageSchema = z.number()

function readStoredToolPanelWidth(): number | null {
  const stored = readStoredValue(WIDTH_STORAGE_KEY)
  if (stored === null) return null
  const parsed = widthStorageSchema.safeParse(parseJsonText(stored))
  return parsed.success && Number.isFinite(parsed.data) ? parsed.data : null
}

export interface ToolPanelWidthState {
  width: number
  minWidth: number
  maxWidth: number
  setWidth: (width: number) => void
}

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
  docked: boolean
  showRail: boolean
}

export function useToolPanelLayout(): ToolPanelLayout {
  const isMobile = useMobile()
  const availableWidth = useAvailableToolPanelWidth()
  const usableWidth = availableWidth - TOOL_PANEL_RAIL_WIDTH
  return {
    docked: !isMobile && usableWidth >= MAIN_CONTENT_MIN_WIDTH + TOOL_PANEL_MIN_WIDTH,
    showRail: !isMobile,
  }
}
