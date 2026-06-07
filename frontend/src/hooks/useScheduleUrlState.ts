import { useCallback, useMemo } from 'react'
import { useUrlParams } from './useUrlParams'

export type ScheduleTab = 'jobs' | 'detail' | 'runs' | 'prompts'
export type ScheduleDialog = 'new' | 'edit' | 'delete' | null
export type PromptDialog = 'new' | 'edit' | 'delete' | 'import' | null

export interface UseScheduleUrlStateReturn {
  scheduleTab: ScheduleTab
  setScheduleTab: (t: ScheduleTab) => void
  dialog: ScheduleDialog
  promptDialog: PromptDialog
  jobId: number | null
  runId: number | null
  templateId: number | null
  openNewJob: () => void
  openEditJob: (jobId: number) => void
  openDeleteJob: (jobId: number) => void
  openNewTemplate: () => void
  openEditTemplate: (templateId: number) => void
  openDeleteTemplate: (templateId: number) => void
  openImportTemplate: () => void
  closeDialog: () => void
  closePromptDialog: () => void
  selectRun: (runId: number | null) => void
  selectJobAndView: (jobId: number) => void
  selectJobAndCloseDialog: (jobId: number) => void
  replaceUrlParams: (updater: (params: URLSearchParams) => void) => void
}

function parseNullableInt(value: string | null): number | null {
  if (value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function useScheduleUrlState(): UseScheduleUrlStateReturn {
  const { searchParams, updateParams } = useUrlParams()

  const scheduleTab = useMemo<ScheduleTab>(() => {
    const tabParam = searchParams.get('scheduleTab')
    if (tabParam === 'detail' || tabParam === 'runs' || tabParam === 'prompts') {
      return tabParam
    }
    return 'jobs'
  }, [searchParams])

  const dialog = useMemo<ScheduleDialog>(() => {
    const d = searchParams.get('scheduleDialog')
    if (d === 'new' || d === 'edit' || d === 'delete') {
      return d
    }
    return null
  }, [searchParams])

  const promptDialog = useMemo<PromptDialog>(() => {
    const d = searchParams.get('promptDialog')
    if (d === 'new' || d === 'edit' || d === 'delete' || d === 'import') {
      return d
    }
    return null
  }, [searchParams])

  const jobId = useMemo<number | null>(() => parseNullableInt(searchParams.get('jobId')), [searchParams])
  const runId = useMemo<number | null>(() => parseNullableInt(searchParams.get('runId')), [searchParams])
  const templateId = useMemo<number | null>(() => parseNullableInt(searchParams.get('templateId')), [searchParams])

  type ScheduleDialogParam = 'scheduleDialog' | 'promptDialog'
  type ScheduleEntityParam = 'jobId' | 'templateId'

  const replaceUrlParams = useCallback(
    (updater: (params: URLSearchParams) => void) => updateParams(updater, 'replace'),
    [updateParams],
  )

  const openEntityDialog = useCallback((
    dialogParam: ScheduleDialogParam,
    dialogValue: Exclude<ScheduleDialog, null> | Exclude<PromptDialog, null>,
    entityParam: ScheduleEntityParam,
    entityId: number | null,
  ) => {
    const otherEntityParam = entityParam === 'jobId' ? 'templateId' : 'jobId'
    updateParams((p) => {
      p.set(dialogParam, dialogValue)
      p.delete(entityParam)
      p.delete(otherEntityParam)
      if (entityId !== null) {
        p.set(entityParam, String(entityId))
      }
    }, 'push')
  }, [updateParams])

  const setScheduleTab = useCallback((tab: ScheduleTab) => {
    replaceUrlParams((p) => {
      if (tab === 'jobs') {
        p.delete('scheduleTab')
      } else {
        p.set('scheduleTab', tab)
      }
    })
  }, [replaceUrlParams])

  const openNewJob = useCallback(() => {
    openEntityDialog('scheduleDialog', 'new', 'jobId', null)
  }, [openEntityDialog])

  const openEditJob = useCallback((id: number) => {
    openEntityDialog('scheduleDialog', 'edit', 'jobId', id)
  }, [openEntityDialog])

  const openDeleteJob = useCallback((id: number) => {
    openEntityDialog('scheduleDialog', 'delete', 'jobId', id)
  }, [openEntityDialog])

  const openNewTemplate = useCallback(() => {
    openEntityDialog('promptDialog', 'new', 'templateId', null)
  }, [openEntityDialog])

  const openEditTemplate = useCallback((id: number) => {
    openEntityDialog('promptDialog', 'edit', 'templateId', id)
  }, [openEntityDialog])

  const openDeleteTemplate = useCallback((id: number) => {
    openEntityDialog('promptDialog', 'delete', 'templateId', id)
  }, [openEntityDialog])

  const openImportTemplate = useCallback(() => {
    openEntityDialog('promptDialog', 'import', 'templateId', null)
  }, [openEntityDialog])

  const closeDialog = useCallback(() => {
    replaceUrlParams((p) => {
      p.delete('scheduleDialog')
    })
  }, [replaceUrlParams])

  const closePromptDialog = useCallback(() => {
    replaceUrlParams((p) => {
      p.delete('promptDialog')
      p.delete('templateId')
    })
  }, [replaceUrlParams])

  const selectRun = useCallback((id: number | null) => {
    replaceUrlParams((p) => {
      if (id === null) {
        p.delete('runId')
      } else {
        p.set('runId', String(id))
      }
    })
  }, [replaceUrlParams])

  const selectJobAndView = useCallback((id: number) => {
    replaceUrlParams((p) => {
      p.set('jobId', String(id))
      p.set('scheduleTab', 'detail')
    })
  }, [replaceUrlParams])

  const selectJobAndCloseDialog = useCallback((id: number) => {
    replaceUrlParams((p) => {
      p.delete('scheduleDialog')
      p.set('jobId', String(id))
    })
  }, [replaceUrlParams])

  return {
    scheduleTab,
    setScheduleTab,
    dialog,
    promptDialog,
    jobId,
    runId,
    templateId,
    openNewJob,
    openEditJob,
    openDeleteJob,
    openNewTemplate,
    openEditTemplate,
    openDeleteTemplate,
    openImportTemplate,
    closeDialog,
    closePromptDialog,
    selectRun,
    selectJobAndView,
    selectJobAndCloseDialog,
    replaceUrlParams,
  }
}
