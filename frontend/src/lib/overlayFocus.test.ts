import { describe, it, expect, afterEach } from 'vitest'
import { stubMatchMedia } from '@/test/test-utils'
import { getFocusedElement, restoreOverlayFocus } from './overlayFocus'

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value)
  document.body.appendChild(element)
  return element
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
  document.body.innerHTML = ''
})

describe('getFocusedElement', () => {
  it('returns the focused element', () => {
    const button = createElement('button')
    button.focus()
    expect(getFocusedElement()).toBe(button)
  })
})

describe('restoreOverlayFocus', () => {
  it('focuses the chat prompt on desktop when focus was on a button', () => {
    stubMatchMedia(true)
    const prompt = createElement('textarea', { 'data-prompt-input': '' })
    const button = createElement('button')
    button.focus()

    const moved = restoreOverlayFocus(button, null)

    expect(moved).toBe(true)
    expect(document.activeElement).toBe(prompt)
  })

  it('returns focus to a specific text field on desktop', () => {
    stubMatchMedia(true)
    const prompt = createElement('textarea', { 'data-prompt-input': '' })
    const search = createElement('input')

    const moved = restoreOverlayFocus(search, null)

    expect(moved).toBe(true)
    expect(document.activeElement).toBe(search)
    expect(document.activeElement).not.toBe(prompt)
  })

  it('keeps focus inside another open overlay', () => {
    stubMatchMedia(true)
    const prompt = createElement('textarea', { 'data-prompt-input': '' })
    const overlay = createElement('div', { role: 'dialog', 'data-state': 'open' })
    const overlayInput = createElement('input')
    overlay.appendChild(overlayInput)

    const moved = restoreOverlayFocus(overlayInput, null)

    expect(moved).toBe(true)
    expect(document.activeElement).toBe(overlayInput)
    expect(document.activeElement).not.toBe(prompt)
  })

  it('does not jump to the prompt behind another open overlay', () => {
    stubMatchMedia(true)
    const prompt = createElement('textarea', { 'data-prompt-input': '' })
    createElement('div', { role: 'dialog', 'data-state': 'open' })
    const button = createElement('button')

    const moved = restoreOverlayFocus(button, null)

    expect(moved).toBe(false)
    expect(document.activeElement).not.toBe(prompt)
  })

  it('focuses a non-text return target on touch devices', () => {
    stubMatchMedia(false)
    const prompt = createElement('textarea', { 'data-prompt-input': '' })
    const button = createElement('button')

    const moved = restoreOverlayFocus(button, null)

    expect(moved).toBe(true)
    expect(document.activeElement).toBe(button)
    expect(document.activeElement).not.toBe(prompt)
  })

  it('does not refocus a text field on touch devices', () => {
    stubMatchMedia(false)
    const comment = createElement('textarea')

    const moved = restoreOverlayFocus(comment, null)

    expect(moved).toBe(false)
    expect(document.activeElement).not.toBe(comment)
  })

  it('falls back to the return target when no prompt exists', () => {
    stubMatchMedia(true)
    const button = createElement('button')

    const moved = restoreOverlayFocus(button, null)

    expect(moved).toBe(true)
    expect(document.activeElement).toBe(button)
  })
})
