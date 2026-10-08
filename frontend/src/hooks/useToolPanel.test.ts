import { describe, expect, it } from 'vitest'
import { toggleToolDialogParams, toggleToolPanelParams } from './useToolPanel'

describe('toggleToolPanelParams', () => {
  it('opens a tool, clears other tools owned params, and preserves unrelated params', () => {
    const params = new URLSearchParams('previewPort=3000&previewPath=%2Fx&keep=1')

    toggleToolPanelParams(params, 'terminal')

    expect(params.get('panel')).toBe('terminal')
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('keeps the opened tool owned params', () => {
    const params = new URLSearchParams('previewPort=3000&previewPath=%2Fx')

    toggleToolPanelParams(params, 'preview')

    expect(params.get('panel')).toBe('preview')
    expect(params.get('previewPort')).toBe('3000')
    expect(params.get('previewPath')).toBe('/x')
  })

  it('closes the active tool and clears every tool param', () => {
    const params = new URLSearchParams('panel=terminal&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000&keep=1')

    toggleToolPanelParams(params, 'terminal')

    expect(params.has('panel')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.has('terminalDirectory')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('switches from one tool to another and clears the previous owned params', () => {
    const params = new URLSearchParams('panel=preview&previewPort=3000&previewPath=%2Fx')

    toggleToolPanelParams(params, 'files')

    expect(params.get('panel')).toBe('files')
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
  })
})

describe('toggleToolDialogParams', () => {
  it('opens a dialog, clears mobileTab and other tools owned params', () => {
    const params = new URLSearchParams('mobileTab=more&previewPort=3000&previewPath=%2Fx&keep=1')

    toggleToolDialogParams(params, 'terminal')

    expect(params.get('dialog')).toBe('terminal')
    expect(params.has('mobileTab')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('keeps the opened tool owned params', () => {
    const params = new URLSearchParams('mobileTab=more&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000')

    toggleToolDialogParams(params, 'terminal')

    expect(params.get('dialog')).toBe('terminal')
    expect(params.get('terminal')).toBe('/bin/sh')
    expect(params.get('terminalDirectory')).toBe('/home')
    expect(params.has('previewPort')).toBe(false)
  })

  it('closes the active dialog and clears every tool param', () => {
    const params = new URLSearchParams('dialog=terminal&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000&keep=1')

    toggleToolDialogParams(params, 'terminal')

    expect(params.has('dialog')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.has('terminalDirectory')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })
})
