import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVisualViewport } from './useVisualViewport'

interface StubViewport {
  height: number
  offsetTop: number
  listeners: Set<() => void>
}

function stubVisualViewport(height: number): StubViewport {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: {
      height,
      offsetTop: 0,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    },
  })
  return { height, offsetTop: 0, listeners }
}

function createInput(id: string): HTMLInputElement {
  const input = document.createElement('input')
  input.id = id
  document.body.appendChild(input)
  return input
}

describe('useVisualViewport', () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  const originalInnerHeight = window.innerHeight

  afterEach(() => {
    if (originalVisualViewport) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    } else {
      // @ts-expect-error allow delete
      delete window.visualViewport
    }
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    })
    document.body.innerHTML = ''
  })

  it('returns 0 when disabled', () => {
    stubVisualViewport(500)
    const { result } = renderHook(() => useVisualViewport({ enabled: false }))
    expect(result.current.keyboardHeight).toBe(0)
  })

  it('reports the keyboard height when a text input is focused', () => {
    window.innerHeight = 800
    const viewport = stubVisualViewport(500)
    const input = createInput('a')
    const { result } = renderHook(() => useVisualViewport())
    act(() => {
      input.focus()
      viewport.listeners.forEach((fn) => fn())
    })
    expect(result.current.keyboardHeight).toBe(300)
  })

  it('preserves the keyboard inset when focus transfers between text inputs', () => {
    window.innerHeight = 800
    const viewport = stubVisualViewport(500)
    const first = createInput('a')
    const second = createInput('b')
    const { result } = renderHook(() => useVisualViewport())

    act(() => {
      first.focus()
      viewport.listeners.forEach((fn) => fn())
    })
    expect(result.current.keyboardHeight).toBe(300)

    act(() => {
      second.focus()
    })
    expect(result.current.keyboardHeight).toBe(300)
  })

  it('drops the keyboard inset when focus leaves all text inputs', () => {
    window.innerHeight = 800
    const viewport = stubVisualViewport(500)
    const input = createInput('a')
    const { result } = renderHook(() => useVisualViewport())

    act(() => {
      input.focus()
      viewport.listeners.forEach((fn) => fn())
    })
    expect(result.current.keyboardHeight).toBe(300)

    act(() => {
      input.blur()
    })
    expect(result.current.keyboardHeight).toBe(0)
  })

  it('does not subscribe to visualViewport when disabled', () => {
    const viewport = stubVisualViewport(500)
    const addEventListener = vi.fn()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: {
        height: 500,
        offsetTop: 0,
        addEventListener,
        removeEventListener: vi.fn(),
      },
    })
    renderHook(() => useVisualViewport({ enabled: false }))
    expect(addEventListener).not.toHaveBeenCalled()
    void viewport
  })
})
