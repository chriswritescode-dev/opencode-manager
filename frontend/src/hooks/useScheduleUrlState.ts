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
  const { search, updateParams } = useUrlParams()

  const searchParams = useMemo(() => new URLSearchParams(search), [search])

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

  const replaceUrlParams = useCallback(
    (updater: (params: URLSearchParams) => void) => updateParams(updater, 'replace'),
    [updateParams],
  )

  const pushUrlParams = useCallback(
    (updater: (params: URLSearchParams) => void) => updateParams(updater, 'push'),
    [updateParams],
  )

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
    pushUrlParams((p) => {
      p.set('scheduleDialog', 'new')
      p.delete('jobId')
      p.delete('templateId')
    })
  }, [pushUrlParams])

  const openEditJob = useCallback((id: number) => {
    pushUrlParams((p) => {
      p.set('scheduleDialog', 'edit')
      p.set('jobId', String(id))
      p.delete('templateId')
    })
  }, [pushUrlParams])

  const openDeleteJob = useCallback((id: number) => {
    pushUrlParams((p) => {
      p.set('scheduleDialog', 'delete')
      p.set('jobId', String(id))
      p.delete('templateId')
    })
  }, [pushUrlParams])

  const openNewTemplate = useCallback(() => {
    pushUrlParams((p) => {
      p.set('promptDialog', 'new')
      p.delete('templateId')
      p.delete('jobId')
    })
  }, [pushUrlParams])

  const openEditTemplate = useCallback((id: number) => {
    pushUrlParams((p) => {
      p.set('promptDialog', 'edit')
      p.set('templateId', String(id))
      p.delete('jobId')
    })
  }, [pushUrlParams])

  const openDeleteTemplate = useCallback((id: number) => {
    pushUrlParams((p) => {
      p.set('promptDialog', 'delete')
      p.set('templateId', String(id))
      p.delete('jobId')
    })
  }, [pushUrlParams])

  const openImportTemplate = useCallback(() => {
    pushUrlParams((p) => {
      p.set('promptDialog', 'import')
      p.delete('templateId')
      p.delete('jobId')
    })
  }, [pushUrlParams])

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
