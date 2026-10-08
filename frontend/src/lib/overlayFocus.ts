import { FINE_POINTER_MEDIA_QUERY } from '@/hooks/useMediaQuery'

const TEXT_FIELD_SELECTOR = 'input, textarea, [contenteditable="true"]'
const PROMPT_INPUT_SELECTOR = 'textarea[data-prompt-input]'
const OPEN_OVERLAY_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

/**
 * Returns the element that currently owns focus, or null outside a DOM environment.
 */
export function getFocusedElement(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

function isFinePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_POINTER_MEDIA_QUERY).matches
  )
}

function isTextField(element: Element): boolean {
  return element.matches(TEXT_FIELD_SELECTOR)
}

function isDisabledTextField(element: HTMLElement): boolean {
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.disabled
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
    if (!returnFocus?.isConnected) return false
    if (!openOverlays.some((overlay) => overlay.contains(returnFocus))) return false
    if (isTextField(returnFocus) && !isDesktop) return false
    returnFocus.focus({ preventScroll: true })
    return true
  }

  if (
    isDesktop &&
    returnFocus?.isConnected &&
    isTextField(returnFocus) &&
    !returnFocus.matches(PROMPT_INPUT_SELECTOR) &&
    !isDisabledTextField(returnFocus) &&
    !isInside(returnFocus, closing)
  ) {
    returnFocus.focus({ preventScroll: true })
    return true
  }

  if (isDesktop) {
    const prompt = findPromptInput()
    if (prompt) {
      prompt.focus({ preventScroll: true })
      return true
    }
  }

  if (
    returnFocus?.isConnected &&
    returnFocus !== document.body &&
    !isInside(returnFocus, closing) &&
    !(isTextField(returnFocus) && !isDesktop)
  ) {
    returnFocus.focus({ preventScroll: true })
    return true
  }

  return false
}
