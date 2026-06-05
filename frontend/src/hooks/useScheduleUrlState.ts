import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

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
  selectJob: (jobId: number | null) => void
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
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])

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

  const setScheduleTab = useCallback((tab: ScheduleTab) => {
    const p = new URLSearchParams(searchRef.current)
    if (tab === 'jobs') {
      p.delete('scheduleTab')
    } else {
      p.set('scheduleTab', tab)
    }
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openNewJob = useCallback(() => {
    const p = new URLSearchParams(searchRef.current)
    p.set('scheduleDialog', 'new')
    p.delete('jobId')
    p.delete('templateId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openEditJob = useCallback((id: number) => {
    const p = new URLSearchParams(searchRef.current)
    p.set('scheduleDialog', 'edit')
    p.set('jobId', String(id))
    p.delete('templateId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openDeleteJob = useCallback((id: number) => {
    const p = new URLSearchParams(searchRef.current)
    p.set('scheduleDialog', 'delete')
    p.set('jobId', String(id))
    p.delete('templateId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openNewTemplate = useCallback(() => {
    const p = new URLSearchParams(searchRef.current)
    p.set('promptDialog', 'new')
    p.delete('templateId')
    p.delete('jobId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openEditTemplate = useCallback((id: number) => {
    const p = new URLSearchParams(searchRef.current)
    p.set('promptDialog', 'edit')
    p.set('templateId', String(id))
    p.delete('jobId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openDeleteTemplate = useCallback((id: number) => {
    const p = new URLSearchParams(searchRef.current)
    p.set('promptDialog', 'delete')
    p.set('templateId', String(id))
    p.delete('jobId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const openImportTemplate = useCallback(() => {
    const p = new URLSearchParams(searchRef.current)
    p.set('promptDialog', 'import')
    p.delete('templateId')
    p.delete('jobId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const replaceUrlParams = useCallback((updater: (params: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchRef.current)
    updater(p)
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const closeDialog = useCallback(() => {
    const p = new URLSearchParams(searchRef.current)
    p.delete('scheduleDialog')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const closePromptDialog = useCallback(() => {
    const p = new URLSearchParams(searchRef.current)
    p.delete('promptDialog')
    p.delete('templateId')
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const selectJob = useCallback((id: number | null) => {
    replaceUrlParams((p) => {
      if (id === null) {
        p.delete('jobId')
      } else {
        p.set('jobId', String(id))
      }
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
    selectJob,
    selectRun,
    selectJobAndView,
    selectJobAndCloseDialog,
    replaceUrlParams,
  }
}
