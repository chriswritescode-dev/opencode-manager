import { z } from 'zod'
import { FINE_POINTER_MEDIA_QUERY } from '@/hooks/useMediaQuery'
import { PROMPT_INPUT_SELECTOR, isPromptInput, isTextEntryElement } from '@/lib/domTargets'

const OPEN_OVERLAY_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

export function getFocusedElement(): HTMLElement | null {
  return 'document' in globalThis && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

function isFinePointer(): boolean {
  if (!('window' in globalThis) || !z.function().safeParse(window.matchMedia).success) return false
  return window.matchMedia(FINE_POINTER_MEDIA_QUERY).matches
}

function focusElement(el: HTMLElement): boolean {
  el.focus({ preventScroll: true })
  return document.activeElement === el
}

function isInside(element: Element, container: Element | null): boolean {
  return container !== null && container.contains(element)
}

function findOpenOverlays(closing: Element | null): Element[] {
  if (!('document' in globalThis)) return []
  return Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).filter(
    (overlay) => overlay !== closing && !isInside(overlay, closing),
  )
}

function findPromptInput(): HTMLTextAreaElement | null {
  if (!('document' in globalThis)) return null
  const prompt = document.querySelector<HTMLTextAreaElement>(PROMPT_INPUT_SELECTOR)
  return prompt && prompt.isConnected && !prompt.disabled ? prompt : null
}

export function hasOpenOverlay(): boolean {
  if (!('document' in globalThis)) return false
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

export function restoreOverlayFocus(returnFocus: HTMLElement | null, closing: Element | null = null): boolean {
  if (!('document' in globalThis)) return false

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
