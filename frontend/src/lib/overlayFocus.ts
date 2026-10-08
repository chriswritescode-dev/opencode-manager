import { FINE_POINTER_MEDIA_QUERY } from '@/hooks/useMediaQuery'
import { PROMPT_INPUT_SELECTOR, isPromptInput, isTextEntryElement } from '@/lib/domTargets'

const OPEN_OVERLAY_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

/**
 * Returns the element that currently owns focus, or null outside a DOM environment.
 */
export function getFocusedElement(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

/**
 * Reports whether the current device uses a fine pointer, such as a mouse or trackpad.
 */
export function isFinePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_POINTER_MEDIA_QUERY).matches
  )
}

function focusElement(el: HTMLElement): boolean {
  el.focus({ preventScroll: true })
  return document.activeElement === el
}

function isInside(element: Element, container: Element | null): boolean {
  return container !== null && container.contains(element)
}

function findOpenOverlays(closing: Element | null): Element[] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).filter(
    (overlay) => overlay !== closing && !isInside(overlay, closing),
  )
}

function findPromptInput(): HTMLTextAreaElement | null {
  if (typeof document === 'undefined') return null
  const prompt = document.querySelector<HTMLTextAreaElement>(PROMPT_INPUT_SELECTOR)
  return prompt && prompt.isConnected && !prompt.disabled ? prompt : null
}

/**
 * Returns whether any dialog or alertdialog overlay is currently open.
 */
export function hasOpenOverlay(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

/**
 * Moves focus after an overlay closes, preferring the chat prompt on desktop while leaving
 * touch devices untouched so the on-screen keyboard stays closed.
 *
 * @returns true when focus was moved, so the caller can prevent its default handling.
 */
export function restoreOverlayFocus(returnFocus: HTMLElement | null, closing: Element | null = null): boolean {
  if (typeof document === 'undefined') return false

  const isDesktop = isFinePointer()
  const openOverlays = findOpenOverlays(closing)

  if (openOverlays.length > 0) {
    const target = returnFocus
    return Boolean(
      target?.isConnected &&
        openOverlays.some((overlay) => overlay.contains(target)) &&
        (isDesktop || !isTextEntryElement(target)) &&
        focusElement(target),
    )
  }

  if (
    isDesktop &&
    returnFocus?.isConnected &&
    isTextEntryElement(returnFocus) &&
    !isPromptInput(returnFocus) &&
    !isInside(returnFocus, closing) &&
    focusElement(returnFocus)
  ) {
    return true
  }

  if (isDesktop) {
    const prompt = findPromptInput()
    if (prompt && focusElement(prompt)) return true
  }

  if (
    returnFocus?.isConnected &&
    returnFocus !== document.body &&
    !isInside(returnFocus, closing) &&
    !(isTextEntryElement(returnFocus) && !isDesktop) &&
    focusElement(returnFocus)
  ) {
    return true
  }

  return false
}
