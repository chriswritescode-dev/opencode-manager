import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useScheduleUrlState } from '../useScheduleUrlState'

/**
 * Captures the current location.search into a ref for test assertions.
 * Must be rendered inside a <MemoryRouter>.
 */
function LocationCatcher({ capturedSearch }: { capturedSearch: { current: string } }) {
  const location = useLocation()
  useEffect(() => {
    capturedSearch.current = location.search
  })
  return null
}

/**
 * Creates a wrapper that captures the current location.search into a ref
 * so tests can verify URL param changes after actions.
 */
function createWrapper(initialEntries: string[], capturedSearch: { current: string }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <LocationCatcher capturedSearch={capturedSearch} />
        {children}
      </MemoryRouter>
    )
  }
}

function renderScheduleUrlState(initialEntries = ['/']) {
  const capturedSearch: { current: string } = { current: '' }
  const wrapper = createWrapper(initialEntries, capturedSearch)
  const rendered = renderHook(() => useScheduleUrlState(), { wrapper })
  return { ...rendered, capturedSearch }
}

describe('useScheduleUrlState', () => {
  it('defaults to jobs tab, null dialog, and null ids when URL is empty', () => {
    const { result } = renderScheduleUrlState()
    expect(result.current.scheduleTab).toBe('jobs')
    expect(result.current.dialog).toBeNull()
    expect(result.current.jobId).toBeNull()
    expect(result.current.runId).toBeNull()
    expect(result.current.templateId).toBeNull()
  })

  it('setScheduleTab updates tab and removes param when set to jobs', () => {
    const { result } = renderScheduleUrlState()
    act(() => {
      result.current.setScheduleTab('prompts')
    })
    expect(result.current.scheduleTab).toBe('prompts')

    act(() => {
      result.current.setScheduleTab('jobs')
    })
    expect(result.current.scheduleTab).toBe('jobs')
  })

  it('openEditJob sets dialog to edit and sets jobId', () => {
    const { result, capturedSearch } = renderScheduleUrlState()
    act(() => {
      result.current.openEditJob(12)
    })
    expect(result.current.dialog).toBe('edit')
    expect(result.current.jobId).toBe(12)
    expect(result.current.templateId).toBeNull()
    expect(capturedSearch.current).toContain('scheduleDialog=edit')
    expect(capturedSearch.current).toContain('jobId=12')
  })

  it('openDeleteTemplate sets promptDialog to delete and sets templateId', () => {
    const { result } = renderScheduleUrlState()
    act(() => {
      result.current.openDeleteTemplate(5)
    })
    expect(result.current.promptDialog).toBe('delete')
    expect(result.current.templateId).toBe(5)
    expect(result.current.jobId).toBeNull()
  })

  it('openImportTemplate sets promptDialog to import and clears templateId', () => {
    const { result } = renderScheduleUrlState(['/?templateId=3&jobId=7'])
    act(() => {
      result.current.openImportTemplate()
    })
    expect(result.current.promptDialog).toBe('import')
    expect(result.current.templateId).toBeNull()
    expect(result.current.jobId).toBeNull()
  })

  it('closeDialog after edit preserves scheduleDialog and jobId', () => {
    const { result, capturedSearch } = renderScheduleUrlState()
    act(() => {
      result.current.openEditJob(12)
    })
    expect(result.current.dialog).toBe('edit')
    expect(result.current.jobId).toBe(12)

    act(() => {
      result.current.closeDialog()
    })
    expect(result.current.dialog).toBeNull()
    expect(result.current.jobId).toBe(12)
    expect(result.current.templateId).toBeNull()
    expect(capturedSearch.current).not.toContain('scheduleDialog')
    expect(capturedSearch.current).toContain('jobId=12')
  })

  it('closeDialog after delete preserves jobId when canceling', () => {
    const { result, capturedSearch } = renderScheduleUrlState()
    act(() => {
      result.current.openDeleteJob(42)
    })
    expect(result.current.dialog).toBe('delete')
    expect(result.current.jobId).toBe(42)

    act(() => {
      result.current.closeDialog()
    })
    expect(result.current.dialog).toBeNull()
    expect(result.current.jobId).toBe(42)
    expect(capturedSearch.current).not.toContain('scheduleDialog')
    expect(capturedSearch.current).toContain('jobId=42')
  })

  it('closePromptDialog after openNewTemplate clears promptDialog and templateId', () => {
    const { result } = renderScheduleUrlState()
    // Open new template
    act(() => {
      result.current.openNewTemplate()
    })
    expect(result.current.promptDialog).toBe('new')
    expect(result.current.templateId).toBeNull()

    // Close prompt dialog
    act(() => {
      result.current.closePromptDialog()
    })
    expect(result.current.promptDialog).toBeNull()
    expect(result.current.templateId).toBeNull()
  })

  it('parses jobId=abc as null (NaN) and runId=44 as 44', () => {
    const { result } = renderScheduleUrlState(['/?jobId=abc&runId=44'])
    expect(result.current.jobId).toBeNull()
    expect(result.current.runId).toBe(44)
  })

  it('preserves unrelated params across setScheduleTab and openEditJob and closeDialog', () => {
    const { result, capturedSearch } = renderScheduleUrlState(['/?assistant=1'])

    // setScheduleTab preserves assistant param
    act(() => {
      result.current.setScheduleTab('runs')
    })
    expect(capturedSearch.current).toContain('assistant=1')
    expect(capturedSearch.current).toContain('scheduleTab=runs')

    // openEditJob preserves assistant param
    act(() => {
      result.current.openEditJob(3)
    })
    expect(capturedSearch.current).toContain('assistant=1')
    expect(capturedSearch.current).toContain('scheduleDialog=edit')

    // closeDialog preserves assistant param
    act(() => {
      result.current.closeDialog()
    })
    expect(capturedSearch.current).toContain('assistant=1')
    expect(capturedSearch.current).not.toContain('scheduleDialog')
  })

  it('openNewJob sets dialog to new and clears jobId and templateId', () => {
    const { result } = renderScheduleUrlState(['/?templateId=2&jobId=5'])
    act(() => {
      result.current.openNewJob()
    })
    expect(result.current.dialog).toBe('new')
    expect(result.current.jobId).toBeNull()
    expect(result.current.templateId).toBeNull()
  })

  it('openDeleteJob sets dialog to delete and sets jobId', () => {
    const { result } = renderScheduleUrlState()
    act(() => {
      result.current.openDeleteJob(42)
    })
    expect(result.current.dialog).toBe('delete')
    expect(result.current.jobId).toBe(42)
    expect(result.current.templateId).toBeNull()
  })

  it('openEditTemplate sets promptDialog to edit and sets templateId', () => {
    const { result } = renderScheduleUrlState()
    act(() => {
      result.current.openEditTemplate(99)
    })
    expect(result.current.promptDialog).toBe('edit')
    expect(result.current.templateId).toBe(99)
    expect(result.current.jobId).toBeNull()
  })

  it('selectRun sets and clears runId', () => {
    const { result } = renderScheduleUrlState()
    act(() => {
      result.current.selectRun(20)
    })
    expect(result.current.runId).toBe(20)

    act(() => {
      result.current.selectRun(null)
    })
    expect(result.current.runId).toBeNull()
  })

  it('reads valid scheduleTab from URL', () => {
    const { result } = renderScheduleUrlState(['/?scheduleTab=detail'])
    expect(result.current.scheduleTab).toBe('detail')
  })

  it('reads valid scheduleDialog from URL', () => {
    const { result } = renderScheduleUrlState(['/?scheduleDialog=edit'])
    expect(result.current.dialog).toBe('edit')
  })

  it('reads valid promptDialog from URL', () => {
    const { result } = renderScheduleUrlState(['/?promptDialog=import'])
    expect(result.current.promptDialog).toBe('import')
  })

  it('resolves invalid tab values to jobs', () => {
    const { result } = renderScheduleUrlState(['/?scheduleTab=invalid'])
    expect(result.current.scheduleTab).toBe('jobs')
  })

  it('resolves invalid dialog values to null', () => {
    const { result } = renderScheduleUrlState(['/?scheduleDialog=invalid'])
    expect(result.current.dialog).toBeNull()
  })

  it('closeDialog for new dialog does not affect jobId', () => {
    const { result, capturedSearch } = renderScheduleUrlState(['/?scheduleDialog=new&jobId=7'])
    expect(result.current.dialog).toBe('new')
    expect(result.current.jobId).toBe(7)

    act(() => {
      result.current.closeDialog()
    })
    expect(result.current.dialog).toBeNull()
    expect(result.current.jobId).toBe(7)
    expect(capturedSearch.current).not.toContain('scheduleDialog')
    expect(capturedSearch.current).toContain('jobId=7')
  })

  it('closePromptDialog for import clears promptDialog but preserves jobId', () => {
    const { result } = renderScheduleUrlState(['/?jobId=7&promptDialog=import'])
    act(() => {
      result.current.closePromptDialog()
    })
    expect(result.current.promptDialog).toBeNull()
    // closePromptDialog does not touch jobId
    expect(result.current.jobId).toBe(7)
  })

  it('returns stable function references across rerenders', () => {
    const { result, rerender } = renderScheduleUrlState()
    const firstSetScheduleTab = result.current.setScheduleTab
    const firstOpenEditJob = result.current.openEditJob
    const firstCloseDialog = result.current.closeDialog
    const firstClosePromptDialog = result.current.closePromptDialog
    const firstSelectJobAndView = result.current.selectJobAndView
    const firstSelectJobAndCloseDialog = result.current.selectJobAndCloseDialog
    const firstReplaceUrlParams = result.current.replaceUrlParams

    rerender()

    expect(result.current.setScheduleTab).toBe(firstSetScheduleTab)
    expect(result.current.openEditJob).toBe(firstOpenEditJob)
    expect(result.current.closeDialog).toBe(firstCloseDialog)
    expect(result.current.closePromptDialog).toBe(firstClosePromptDialog)
    expect(result.current.selectJobAndView).toBe(firstSelectJobAndView)
    expect(result.current.selectJobAndCloseDialog).toBe(firstSelectJobAndCloseDialog)
    expect(result.current.replaceUrlParams).toBe(firstReplaceUrlParams)
  })

  describe('combined atomic URL mutations', () => {
    it('selectJobAndView sets jobId and scheduleTab in a single navigation', () => {
      const { result, capturedSearch } = renderScheduleUrlState()
      act(() => {
        result.current.selectJobAndView(42)
      })
      expect(result.current.jobId).toBe(42)
      expect(result.current.scheduleTab).toBe('detail')
      expect(capturedSearch.current).toContain('jobId=42')
      expect(capturedSearch.current).toContain('scheduleTab=detail')
    })

    it('selectJobAndView preserves unrelated params', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?assistant=1'])
      act(() => {
        result.current.selectJobAndView(99)
      })
      expect(capturedSearch.current).toContain('assistant=1')
      expect(capturedSearch.current).toContain('jobId=99')
      expect(capturedSearch.current).toContain('scheduleTab=detail')
    })

    it('selectJobAndCloseDialog sets jobId and removes scheduleDialog', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?scheduleDialog=new'])
      act(() => {
        result.current.selectJobAndCloseDialog(7)
      })
      expect(result.current.jobId).toBe(7)
      expect(result.current.dialog).toBeNull()
      expect(capturedSearch.current).not.toContain('scheduleDialog')
      expect(capturedSearch.current).toContain('jobId=7')
    })

    it('selectJobAndCloseDialog from edit preserves jobId and removes dialog', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?scheduleDialog=edit&jobId=3'])
      act(() => {
        result.current.selectJobAndCloseDialog(3)
      })
      expect(result.current.jobId).toBe(3)
      expect(result.current.dialog).toBeNull()
      expect(capturedSearch.current).not.toContain('scheduleDialog')
      expect(capturedSearch.current).toContain('jobId=3')
    })

    it('selectJobAndCloseDialog preserves unrelated params', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?scheduleDialog=edit&assistant=1'])
      act(() => {
        result.current.selectJobAndCloseDialog(5)
      })
      expect(capturedSearch.current).toContain('assistant=1')
      expect(capturedSearch.current).not.toContain('scheduleDialog')
      expect(capturedSearch.current).toContain('jobId=5')
    })

    it('replaceUrlParams can set and delete multiple params atomically', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?foo=1&bar=2'])
      act(() => {
        result.current.replaceUrlParams((p) => {
          p.set('jobId', '10')
          p.set('scheduleTab', 'runs')
          p.delete('foo')
        })
      })
      expect(result.current.jobId).toBe(10)
      expect(result.current.scheduleTab).toBe('runs')
      expect(capturedSearch.current).toContain('jobId=10')
      expect(capturedSearch.current).toContain('scheduleTab=runs')
      expect(capturedSearch.current).not.toContain('foo=')
      expect(capturedSearch.current).toContain('bar=2')
    })

    it('replaceUrlParams preserves all params when no modifications are made', () => {
      const { result, capturedSearch } = renderScheduleUrlState(['/?jobId=5&scheduleTab=detail'])
      act(() => {
        result.current.replaceUrlParams((_p) => {
          // No modifications
        })
      })
      expect(result.current.jobId).toBe(5)
      expect(result.current.scheduleTab).toBe('detail')
      expect(capturedSearch.current).toContain('jobId=5')
      expect(capturedSearch.current).toContain('scheduleTab=detail')
    })
  })

  describe('push/replace history mode', () => {
    it('openNewJob uses push so navigate(-1) closes the dialog', () => {
      function PushHarness() {
        const { dialog, openNewJob } = useScheduleUrlState()
        const navigate = useNavigate()
        const [step, setStep] = useState<'start' | 'opened' | 'back'>('start')
        const handled = useRef(false)

        useEffect(() => {
          if (handled.current) return
          if (step === 'opened') {
            handled.current = true
            openNewJob()
          } else if (step === 'back') {
            handled.current = true
            navigate(-1)
          }
        }, [step, openNewJob, navigate])

        return (
          <div>
            <span data-testid="dialog">{dialog ?? 'null'}</span>
            <button onClick={() => { handled.current = false; setStep('opened') }}>
              open
            </button>
            <button onClick={() => { handled.current = false; setStep('back') }}>
              back
            </button>
          </div>
        )
      }

      render(
        <MemoryRouter initialEntries={['/other', '/']}>
          <PushHarness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('dialog').textContent).toBe('null')

      act(() => { screen.getByText('open').click() })
      expect(screen.getByTestId('dialog').textContent).toBe('new')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('dialog').textContent).toBe('null')
    })

    it('setScheduleTab uses replace so navigate(-1) does not step through tab changes', () => {
      function ReplaceHarness() {
        const { scheduleTab, setScheduleTab } = useScheduleUrlState()
        const navigate = useNavigate()
        const [step, setStep] = useState<'start' | 'switched' | 'back'>('start')
        const handled = useRef(false)

        useEffect(() => {
          if (handled.current) return
          if (step === 'switched') {
            handled.current = true
            setScheduleTab('runs')
          } else if (step === 'back') {
            handled.current = true
            navigate(-1)
          }
        }, [step, setScheduleTab, navigate])

        return (
          <div>
            <span data-testid="scheduleTab">{scheduleTab}</span>
            <button onClick={() => { handled.current = false; setStep('switched') }}>
              switch
            </button>
            <button onClick={() => { handled.current = false; setStep('back') }}>
              back
            </button>
          </div>
        )
      }

      render(
        <MemoryRouter initialEntries={['/other', '/']}>
          <ReplaceHarness />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('scheduleTab').textContent).toBe('jobs')

      act(() => { screen.getByText('switch').click() })
      expect(screen.getByTestId('scheduleTab').textContent).toBe('runs')

      act(() => { screen.getByText('back').click() })
      expect(screen.getByTestId('scheduleTab').textContent).toBe('jobs')
    })

    it('openEditTemplate(7) sets promptDialog=edit and templateId=7', () => {
      const { result } = renderScheduleUrlState()
      act(() => {
        result.current.openEditTemplate(7)
      })
      expect(result.current.promptDialog).toBe('edit')
      expect(result.current.templateId).toBe(7)
    })
  })
})
