const CONTENT_EDITABLE_VALUES = new Set(['', 'true', 'plaintext-only'])

export function isTextEntryElement(element: Element): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const contentEditable = element.getAttribute('contenteditable')
  return contentEditable !== null && CONTENT_EDITABLE_VALUES.has(contentEditable.toLowerCase())
}

export function isPromptInput(element: Element): boolean {
  return element.hasAttribute('data-prompt-input')
}

export const PROMPT_INPUT_SELECTOR = 'textarea[data-prompt-input]'
