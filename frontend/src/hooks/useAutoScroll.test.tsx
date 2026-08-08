import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoScroll } from './useAutoScroll'
import type { Message } from '../api/types'

function createScrollContainer() {
  const div = document.createElement('div')
  document.body.appendChild(div)

  let scrollTopValue = 0
  const clientHeight = 400
  let scrollHeightValue = 800

  Object.defineProperty(div, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })

  Object.defineProperty(div, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeightValue,
  })

  Object.defineProperty(div, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      scrollTopValue = Math.max(0, Math.min(value, scrollHeightValue - clientHeight))
      div.dispatchEvent(new Event('scroll'))
    },
  })

  return {
    div,
    setScrollHeight: (value: number) => {
      scrollHeightValue = value
    },
    getScrollTop: () => scrollTopValue,
    setScrollTop: (value: number) => {
      scrollTopValue = value
    },
    cleanup: () => {
      document.body.removeChild(div)
    },
  }
}

describe('useAutoScroll', () => {
  let containerHarness: ReturnType<typeof createScrollContainer> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
  })

  afterEach(() => {
    if (containerHarness) {
      containerHarness.cleanup()
      containerHarness = null
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllTimers()
  })

  const createMessage = (id: string, role: 'user' | 'assistant'): Message => ({
    id,
    sessionID: 'session-1',
    role,
    time: { created: Date.now() },
  } as Message)

  const setupHook = (messages: Message[], sessionId = 'session-1') => {
    containerHarness = createScrollContainer()
    const containerRef = { current: containerHarness.div }
    const onScrollStateChange = vi.fn()

    const renderResult = renderHook(
      (props) =>
        useAutoScroll({
          containerRef: props.containerRef,
          messages: props.messages,
          sessionId: props.sessionId,
          contentVersion: props.contentVersion,
          onScrollStateChange: props.onScrollStateChange,
        }),
      {
        initialProps: {
          containerRef,
          messages,
          sessionId,
          contentVersion: messages.length,
          onScrollStateChange,
        },
      }
    )

    return { renderResult, containerHarness, onScrollStateChange }
  }

  it('scrolls to bottom on initial messages', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { containerHarness } = setupHook(messages)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('auto-follows when new assistant message arrives', () => {
    const messages = [createMessage('1', 'user')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    const initialScrollTop = containerHarness.getScrollTop()
    expect(initialScrollTop).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)

    containerHarness.setScrollHeight(containerHarness.div.scrollHeight + 200)
    const newMessages = [...messages, createMessage('2', 'assistant')]

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages: newMessages,
        sessionId: 'session-1',
        contentVersion: newMessages.length,
        onScrollStateChange,
      })
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('stays engaged after scrollToBottom() through streaming reflow drift', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      renderResult.result.current.scrollToBottom()
    })

    const bottomPosition = containerHarness.div.scrollHeight - containerHarness.div.clientHeight
    containerHarness.setScrollTop(bottomPosition - 2)

    act(() => {
      containerHarness.div.dispatchEvent(new Event('scroll'))
    })

    containerHarness.setScrollHeight(containerHarness.div.scrollHeight + 100)

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages,
        sessionId: 'session-1',
        contentVersion: messages.length + 1,
        onScrollStateChange,
      })
      vi.advanceTimersByTime(100)
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('scrolls to bottom again after layout frames', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { renderResult, containerHarness } = setupHook(messages)

    act(() => {
      renderResult.result.current.scrollToBottom()
    })

    containerHarness.setScrollHeight(containerHarness.div.scrollHeight + 300)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('does not keep forcing bottom after user scrolls up', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      renderResult.result.current.scrollToBottom()
    })

    const userPosition = 100
    act(() => {
      containerHarness.setScrollTop(userPosition)
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
      vi.runOnlyPendingTimers()
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)
    expect(containerHarness.getScrollTop()).toBe(userPosition)
  })

  it('cancels pending bottom scroll as soon as user touches the list', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { renderResult, containerHarness } = setupHook(messages)

    act(() => {
      renderResult.result.current.scrollToBottom()
    })

    const userPosition = 120
    act(() => {
      containerHarness.div.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientY: 200,
          bubbles: true,
        })
      )
      containerHarness.setScrollTop(userPosition)
      vi.runOnlyPendingTimers()
    })

    expect(containerHarness.getScrollTop()).toBe(userPosition)
  })

  it('cancels pending bottom scroll when user wheel-scrolls up before pending frames complete', () => {
    const messages = [createMessage('1', 'user'), createMessage('2', 'assistant')]
    const { renderResult, containerHarness } = setupHook(messages)

    act(() => {
      renderResult.result.current.scrollToBottom()
    })

    const userPosition = 150
    act(() => {
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
      containerHarness.setScrollTop(userPosition)
      vi.runOnlyPendingTimers()
    })

    expect(containerHarness.getScrollTop()).toBe(userPosition)
  })

  it('does not show scroll button on tiny upward drag from bottom', () => {
    const messages = [createMessage('1', 'user')]
    const { containerHarness, onScrollStateChange } = setupHook(messages)
    const bottomPosition = containerHarness.div.scrollHeight - containerHarness.div.clientHeight

    act(() => {
      containerHarness.setScrollTop(bottomPosition - 20)
      containerHarness.div.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientY: 200,
          bubbles: true,
        })
      )
      containerHarness.div.dispatchEvent(
        new PointerEvent('pointermove', {
          clientY: 260,
          bubbles: true,
        })
      )
    })

    expect(onScrollStateChange).not.toHaveBeenCalledWith(true)
  })

  it('disengages when user fires a wheel-up event', () => {
    const messages = [createMessage('1', 'user')]
    const { containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      containerHarness.setScrollTop(100)
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)

    const bottomPosition = containerHarness.div.scrollHeight - containerHarness.div.clientHeight
    containerHarness.setScrollHeight(bottomPosition + 200)

    const currentScrollTop = containerHarness.getScrollTop()
    expect(currentScrollTop).not.toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('disengages when user drags upward (pointer down -> move up -> up)', () => {
    const messages = [createMessage('1', 'user')]
    const { containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      containerHarness.setScrollTop(100)
      containerHarness.div.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientY: 200,
          bubbles: true,
        })
      )
      containerHarness.div.dispatchEvent(
        new PointerEvent('pointermove', {
          clientY: 260,
          bubbles: true,
        })
      )
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)

    const bottomPosition = containerHarness.div.scrollHeight - containerHarness.div.clientHeight
    containerHarness.setScrollHeight(bottomPosition + 200)

    const currentScrollTop = containerHarness.getScrollTop()
    expect(currentScrollTop).not.toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('disengages when mobile touch scrolls upward without pointer events', () => {
    const messages = [createMessage('1', 'user')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      containerHarness.setScrollTop(100)
      containerHarness.div.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientY: 200 } as Touch],
        bubbles: true,
      }))
      containerHarness.div.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientY: 260 } as Touch],
        bubbles: true,
      }))
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)

    containerHarness.setScrollHeight(containerHarness.div.scrollHeight + 200)

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages,
        sessionId: 'session-1',
        contentVersion: messages.length + 1,
        onScrollStateChange,
      })
      vi.runOnlyPendingTimers()
    })

    expect(containerHarness.getScrollTop()).toBe(100)
  })

  it('shows scroll button when streaming growth carries disengaged user past threshold', () => {
    const messages = [createMessage('1', 'user')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)
    const nearBottomPosition = containerHarness.div.scrollHeight - containerHarness.div.clientHeight - 60

    act(() => {
      containerHarness.setScrollTop(nearBottomPosition)
      containerHarness.div.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientY: 200 } as Touch],
        bubbles: true,
      }))
      containerHarness.div.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientY: 260 } as Touch],
        bubbles: true,
      }))
    })

    expect(onScrollStateChange).not.toHaveBeenCalledWith(true)

    containerHarness.setScrollHeight(containerHarness.div.scrollHeight + 200)

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages,
        sessionId: 'session-1',
        contentVersion: messages.length + 1,
        onScrollStateChange,
      })
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)
    expect(containerHarness.getScrollTop()).toBe(nearBottomPosition)
  })

  it('re-engages when user scrolls back to within threshold', () => {
    const messages = [createMessage('1', 'user')]
    const { containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      containerHarness.setScrollTop(100)
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)

    const scrollHeight = containerHarness.div.scrollHeight
    const clientHeight = containerHarness.div.clientHeight
    const withinThresholdPosition = scrollHeight - clientHeight - 30

    act(() => {
      containerHarness.setScrollTop(withinThresholdPosition)
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(false)
  })

  it('always scrolls to bottom when user sends a message', () => {
    const messages = [createMessage('1', 'assistant')]
    const { renderResult, containerHarness, onScrollStateChange } = setupHook(messages)

    act(() => {
      containerHarness.setScrollTop(100)
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
    })

    expect(onScrollStateChange).toHaveBeenCalledWith(true)

    const newMessages = [...messages, createMessage('2', 'user')]

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages: newMessages,
        sessionId: 'session-1',
        contentVersion: newMessages.length,
        onScrollStateChange,
      })
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })

  it('resets state when sessionId changes', () => {
    const messages = [createMessage('1', 'user')]
    const { renderResult, containerHarness } = setupHook(messages, 'session-1')

    act(() => {
      containerHarness.div.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -50,
          bubbles: true,
        })
      )
    })

    const newMessages = [createMessage('2', 'user')]

    act(() => {
      renderResult.rerender({
        containerRef: { current: containerHarness.div },
        messages: newMessages,
        sessionId: 'session-2',
        contentVersion: newMessages.length,
        onScrollStateChange: vi.fn(),
      })
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(containerHarness.getScrollTop()).toBe(containerHarness.div.scrollHeight - containerHarness.div.clientHeight)
  })
})
