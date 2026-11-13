import { useCallback, useEffect } from 'react'
import { openDialogParams } from './useDialogParam'
import { useUrlParams } from './useUrlParams'

const PANEL_PARAM = 'panel'

const PANEL_TOOLS = ['sourceControl', 'files', 'terminal', 'walkthrough', 'preview', 'mcp', 'actions', 'skills', 'schedules', 'sessions', 'secrets'] as const

export type PanelTool = (typeof PANEL_TOOLS)[number]

export type ToolPanelToggleAction = 'open' | 'switch' | 'close'

const TOOL_OWNED_PARAMS = {
  terminal: ['terminal', 'terminalDirectory'],
  preview: ['previewPort', 'previewPath'],
  schedules: ['scheduleTab', 'scheduleDialog', 'jobId', 'runId'],
} satisfies Partial<Record<PanelTool, readonly string[]>>

const PANEL_ONLY_TOOLS: ReadonlySet<PanelTool> = new Set(['schedules', 'sessions'])

export function isPanelTool(value: string | null): value is PanelTool {
  return value !== null && PANEL_TOOLS.some((tool) => tool === value)
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
  openDialogParams(params, tool)
  clearToolParams(params, tool)
}

export function resolveToolPanelToggle(currentTool: string | null, tool: PanelTool): ToolPanelToggleAction {
  if (currentTool === tool) return 'close'
  return isPanelTool(currentTool) ? 'switch' : 'open'
}

export function clearToolPanelParams(params: URLSearchParams): void {
  params.delete(PANEL_PARAM)
  clearToolParams(params)
}

export function useToolPanelToggle(): (tool: PanelTool) => void {
  const { searchParams, updateParams, closePushedParams } = useUrlParams()
  const panelParam = searchParams.get(PANEL_PARAM)

  return useCallback((tool: PanelTool) => {
    const action = resolveToolPanelToggle(panelParam, tool)
    if (action === 'close') {
      closePushedParams(clearToolPanelParams)
      return
    }
    updateParams((params) => toggleToolPanelParams(params, tool), action === 'switch' ? 'replace' : 'push')
  }, [panelParam, updateParams, closePushedParams])
}

export interface ToolPanelState {
  activeTool: PanelTool | null
  toggleTool: (tool: PanelTool) => void
  closePanel: () => void
}

export function useToolPanel(panelAvailable: boolean): ToolPanelState {
  const { searchParams, updateParams, closePushedParams } = useUrlParams()
  const panelParam = searchParams.get(PANEL_PARAM)
  const dialogParam = searchParams.get('dialog')
  const activeTool = panelAvailable && isPanelTool(panelParam) ? panelParam : null

  useEffect(() => {
    if (panelAvailable && isPanelTool(dialogParam)) {
      updateParams((params) => {
        params.delete('dialog')
        params.set(PANEL_PARAM, dialogParam)
        clearToolParams(params, dialogParam)
      }, 'replace')
      return
    }
    if (!panelAvailable && isPanelTool(panelParam)) {
      updateParams((params) => {
        params.delete(PANEL_PARAM)
        if (PANEL_ONLY_TOOLS.has(panelParam)) {
          clearToolParams(params)
          return
        }
        if (!params.has('dialog')) params.set('dialog', panelParam)
      }, 'replace')
    }
  }, [panelAvailable, dialogParam, panelParam, updateParams])

  const closePanel = useCallback(() => {
    closePushedParams(clearToolPanelParams)
  }, [closePushedParams])

  const toggleTool = useToolPanelToggle()

  return { activeTool, toggleTool, closePanel }
}
