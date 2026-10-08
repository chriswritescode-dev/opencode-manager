import { useCallback, useEffect } from 'react'
import { useUrlParams } from './useUrlParams'

const PANEL_PARAM = 'panel'

const PANEL_TOOLS = ['sourceControl', 'files', 'terminal', 'walkthrough', 'preview', 'mcp', 'actions', 'skills', 'schedules'] as const

export type PanelTool = (typeof PANEL_TOOLS)[number]

const TOOL_OWNED_PARAMS: Partial<Record<PanelTool, readonly string[]>> = {
  terminal: ['terminal', 'terminalDirectory'],
  preview: ['previewPort', 'previewPath'],
  schedules: ['scheduleTab', 'scheduleDialog', 'jobId', 'runId'],
}

const PANEL_ONLY_TOOLS: ReadonlySet<PanelTool> = new Set(['schedules'])

export function isPanelTool(value: string | null): value is PanelTool {
  return value !== null && (PANEL_TOOLS as readonly string[]).includes(value)
}

function clearToolParams(params: URLSearchParams, keep?: PanelTool): void {
  for (const [tool, owned] of Object.entries(TOOL_OWNED_PARAMS)) {
    if (tool === keep) continue
    for (const param of owned) params.delete(param)
  }
}

export function toggleToolPanelParams(params: URLSearchParams, tool: PanelTool): void {
  if (params.get(PANEL_PARAM) === tool) {
    params.delete(PANEL_PARAM)
    clearToolParams(params)
    return
  }
  params.set(PANEL_PARAM, tool)
  clearToolParams(params, tool)
}

export function toggleToolDialogParams(params: URLSearchParams, tool: PanelTool): void {
  if (params.get('dialog') === tool) {
    params.delete('dialog')
    clearToolParams(params)
    return
  }
  params.set('dialog', tool)
  params.delete('mobileTab')
  clearToolParams(params, tool)
}

export interface ToolPanelState {
  activeTool: PanelTool | null
  toggleTool: (tool: PanelTool) => void
  closePanel: () => void
}

/**
 * URL state of the docked desktop tool panel (`?panel=`). While docked, a tool opened through the
 * shared `?dialog=` param is moved into the panel; when not docked, an open panel tool falls back to its dialog,
 * or closes when it has none.
 */
export function useToolPanel(docked: boolean): ToolPanelState {
  const { searchParams, updateParams } = useUrlParams()
  const panelParam = searchParams.get(PANEL_PARAM)
  const dialogParam = searchParams.get('dialog')
  const activeTool = docked && isPanelTool(panelParam) ? panelParam : null

  useEffect(() => {
    if (docked && isPanelTool(dialogParam)) {
      updateParams((params) => {
        params.delete('dialog')
        params.set(PANEL_PARAM, dialogParam)
        clearToolParams(params, dialogParam)
      }, 'replace')
      return
    }
    if (!docked && isPanelTool(panelParam)) {
      updateParams((params) => {
        params.delete(PANEL_PARAM)
        if (PANEL_ONLY_TOOLS.has(panelParam)) {
          clearToolParams(params)
          return
        }
        if (!params.has('dialog')) params.set('dialog', panelParam)
      }, 'replace')
    }
  }, [docked, dialogParam, panelParam, updateParams])

  const toggleTool = useCallback((tool: PanelTool) => {
    updateParams((params) => toggleToolPanelParams(params, tool), 'push')
  }, [updateParams])

  const closePanel = useCallback(() => {
    updateParams((params) => {
      params.delete(PANEL_PARAM)
      clearToolParams(params)
    }, 'replace')
  }, [updateParams])

  return { activeTool, toggleTool, closePanel }
}
