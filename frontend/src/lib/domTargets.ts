const CONTENT_EDITABLE_VALUES = new Set(['', 'true', 'plaintext-only'])

/**
 * Returns true for free-text entry targets: `<input>`, `<textarea>`, and any content-editable
 * element (`contenteditable=""`, `"true"`, or `"plaintext-only"`).
 */
export function isTextEntryElement(element: Element): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const contentEditable = element.getAttribute('contenteditable')
  return contentEditable !== null && CONTENT_EDITABLE_VALUES.has(contentEditable.toLowerCase())
}

/**
 * Returns true when the element carries the `data-prompt-input` attribute that marks the chat prompt.
 */
export function isPromptInput(element: Element): boolean {
  return element.hasAttribute('data-prompt-input')
}

/**
 * Selector matching the chat prompt input.
 */
export const PROMPT_INPUT_SELECTOR = 'textarea[data-prompt-input]'
