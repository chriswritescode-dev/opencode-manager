import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../sw?worker', () => ({}))

import { onNotificationClick } from './serviceWorker'

function defineServiceWorkerTarget(target: EventTarget) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: target,
    configurable: true,
  })
}

describe('onNotificationClick', () => {
  beforeEach(() => {
    if ('serviceWorker' in navigator) {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })

  it('calls the handler for NOTIFICATION_CLICK messages', () => {
    const target = new EventTarget()
    defineServiceWorkerTarget(target)
    const handler = vi.fn()

    const unsubscribe = onNotificationClick(handler)
    target.dispatchEvent(
      new MessageEvent('message', { data: { type: 'NOTIFICATION_CLICK', url: '/x' } })
    )

    expect(handler).toHaveBeenCalledWith('/x')
    unsubscribe()
  })

  it('ignores messages with other types', () => {
    const target = new EventTarget()
    defineServiceWorkerTarget(target)
    const handler = vi.fn()

    const unsubscribe = onNotificationClick(handler)
    target.dispatchEvent(new MessageEvent('message', { data: { type: 'SW_UPDATED' } }))
    target.dispatchEvent(new MessageEvent('message', { data: null }))

    expect(handler).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('stops calling the handler after unsubscribe', () => {
    const target = new EventTarget()
    defineServiceWorkerTarget(target)
    const handler = vi.fn()

    const unsubscribe = onNotificationClick(handler)
    unsubscribe()
    target.dispatchEvent(
      new MessageEvent('message', { data: { type: 'NOTIFICATION_CLICK', url: '/y' } })
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('returns a no-op unsubscribe when service workers are unsupported', () => {
    const unsubscribe = onNotificationClick(vi.fn())
    expect(() => unsubscribe()).not.toThrow()
  })
})
