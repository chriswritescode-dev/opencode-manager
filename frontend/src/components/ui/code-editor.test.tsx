import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeEditor } from './code-editor'

function requireHtmlElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
  return element
}

function editorTextarea(): HTMLTextAreaElement {
  const element = screen.getByLabelText('config')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('Expected the editor textarea')
  return element
}

function editorMirror(container: HTMLElement): HTMLElement {
  return requireHtmlElement(container, '[data-editor-mirror]')
}

function markRect(top: number, height: number): DOMRect {
  return new DOMRect(0, top, 0, height)
}

function patchRect(target: Element, value: DOMRect) {
  Object.defineProperty(target, 'getBoundingClientRect', {
    configurable: true,
    value: () => value,
  })
}

describe('CodeEditor', () => {
  it('renders a line number for every logical line', () => {
    render(<CodeEditor value={'{\n  "a": 1\n}'} onChange={vi.fn()} ariaLabel="config" />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders a trailing empty line number when the value ends in a newline', () => {
    render(<CodeEditor value={'a\n'} onChange={vi.fn()} ariaLabel="config" />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('reports edits through onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CodeEditor value="" onChange={onChange} ariaLabel="config" />)
    await user.type(screen.getByLabelText('config'), 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('applies identical font, wrap and tab metrics to the textarea and the mirror', () => {
    const { container } = render(<CodeEditor value={'a'} onChange={vi.fn()} ariaLabel="config" />)
    const textarea = editorTextarea()
    const mirror = editorMirror(container)
    for (const token of ['font-mono', 'text-[16px]', 'min-[769px]:text-sm', 'leading-6', '[tab-size:2]', 'whitespace-pre-wrap', '[overflow-wrap:anywhere]', 'py-2', 'pr-3', 'pl-10', '[scrollbar-gutter:stable]']) {
      expect(textarea.className).toContain(token)
      expect(mirror.className).toContain(token)
    }
  })

  it('keeps the mirror hidden from assistive tech', () => {
    const { container } = render(<CodeEditor value={'a'} onChange={vi.fn()} ariaLabel="config" />)
    expect(editorMirror(container)).toHaveAttribute('aria-hidden', 'true')
  })

  it('mirrors textarea scrolling', () => {
    const { container } = render(<CodeEditor value={'a\nb\nc'} onChange={vi.fn()} ariaLabel="config" />)
    const textarea = editorTextarea()
    const mirror = editorMirror(container)
    textarea.scrollTop = 120
    textarea.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(mirror.scrollTop).toBe(120)
  })

  const HIGHLIGHT_VALUE = '{\n  "model": "sonnet",\n  "theme": "sonnet"\n}'

  it('renders a mark for each highlight', () => {
    const { container } = render(
      <CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 14, endIndex: 20 }, { startIndex: 35, endIndex: 41 }]} activeHighlightIndex={0} />,
    )
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toHaveTextContent('sonnet')
  })

  it('flags only the active match', () => {
    const { container } = render(
      <CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 14, endIndex: 20 }, { startIndex: 35, endIndex: 41 }]} activeHighlightIndex={1} />,
    )
    const active = container.querySelectorAll('mark[data-active-match="true"]')
    expect(active).toHaveLength(1)
    expect(active[0]).toBe(container.querySelectorAll('mark')[1])
  })

  it('keeps highlights rendered while the textarea is focused', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 14, endIndex: 20 }]} activeHighlightIndex={0} />,
    )
    await user.click(screen.getByLabelText('config'))
    expect(container.querySelectorAll('mark')).toHaveLength(1)
  })

  it('hides the textarea glyphs only while highlights are active', () => {
    const { container, rerender } = render(<CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config" />)
    expect(editorTextarea().className).not.toContain('text-transparent')
    expect(editorMirror(container).className).toContain('text-transparent')

    rerender(<CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config"
      highlights={[{ startIndex: 14, endIndex: 20 }]} activeHighlightIndex={0} />)
    expect(editorTextarea().className).toContain('text-transparent')
    expect(editorMirror(container).className).not.toContain('text-transparent')
  })

  it('splits a highlight that spans a newline across both rows', () => {
    const { container } = render(
      <CodeEditor value={'abc\ndef'} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 2, endIndex: 5 }]} activeHighlightIndex={0} />,
    )
    const rows = container.querySelectorAll('[data-line]')
    expect(rows[0].querySelector('mark')).toHaveTextContent('c')
    expect(rows[1].querySelector('mark')).toHaveTextContent('d')
    const active = container.querySelectorAll('mark[data-active-match="true"]')
    expect(active).toHaveLength(1)
    expect(active[0]).toBe(rows[0].querySelector('mark'))
  })

  it('buckets out-of-order highlights to the correct rows without re-scanning', () => {
    const { container } = render(
      <CodeEditor value={'aaaa\nbbbb\ncccc\ndddd'} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: 10, endIndex: 14 },
          { startIndex: 0, endIndex: 2 },
        ]} activeHighlightIndex={0} />,
    )
    const rows = container.querySelectorAll('[data-line]')
    expect(rows[0].querySelector('mark')).toHaveTextContent('aa')
    expect(rows[2].querySelector('mark')).toHaveTextContent('cccc')
    expect(container.querySelectorAll('mark')).toHaveLength(2)
  })

  it('marks the active line row', () => {
    const { container } = render(<CodeEditor value={'a\nb\nc'} onChange={vi.fn()} ariaLabel="config" activeLine={2} />)
    const banded = container.querySelectorAll('[data-active-line]')
    expect(banded).toHaveLength(1)
    expect(banded[0].closest('[data-line]')).toHaveAttribute('data-line', '2')
  })

  it('flags the active line number', () => {
    const { container } = render(<CodeEditor value={'a\nb\nc'} onChange={vi.fn()} ariaLabel="config" activeLine={2} />)
    const number = requireHtmlElement(container, '[data-line="2"] [data-line-number]')
    expect(number.className).toContain('text-destructive')
  })

  it('scrolls the active line into view', () => {
    const longValue = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const { container, rerender } = render(<CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config" />)
    const textarea = editorTextarea()
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 960 })
    const row = requireHtmlElement(container, '[data-line="30"]')
    Object.defineProperty(row, 'offsetTop', { configurable: true, value: 700 })
    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 24 })

    rerender(<CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config" activeLine={30} />)

    const mirror = editorMirror(container)
    expect(textarea.scrollTop).toBe(612)
    expect(mirror.scrollTop).toBe(612)
  })

  it('reveals the active match at the bottom of a tall wrapped line', () => {
    const startMatch = 'needleStart'
    const endMatch = 'needleEnd'
    const longValue = startMatch + 'x'.repeat(2000) + endMatch
    const startIdx = 0
    const startEnd = startMatch.length
    const endIdx = longValue.indexOf(endMatch)
    const endEnd = endIdx + endMatch.length

    const { container, rerender } = render(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={1} />,
    )
    const textarea = editorTextarea()
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 1600 })
    const mirror = editorMirror(container)
    patchRect(mirror, markRect(0, 1600))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[1], markRect(1500, 24))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={1} revealNonce={1} />,
    )
    expect(textarea.scrollTop).toBe(1400)
    expect(mirror.scrollTop).toBe(1400)
  })

  it('reveals the active match at the top of a tall wrapped line', () => {
    const startMatch = 'needleStart'
    const endMatch = 'needleEnd'
    const longValue = startMatch + 'x'.repeat(2000) + endMatch
    const startIdx = 0
    const startEnd = startMatch.length
    const endIdx = longValue.indexOf(endMatch)
    const endEnd = endIdx + endMatch.length

    const { container, rerender } = render(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={0} />,
    )
    const textarea = editorTextarea()
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 1600 })
    const mirror = editorMirror(container)
    patchRect(mirror, markRect(0, 1600))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[0], markRect(0, 24))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={0} revealNonce={1} />,
    )
    expect(textarea.scrollTop).toBe(0)
    expect(mirror.scrollTop).toBe(0)
  })

  it('falls back to line reveal when the active mark is not present', () => {
    const longValue = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const startIdx = 0
    const startEnd = 4

    const { container, rerender } = render(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: startIdx, endIndex: startEnd }]} activeHighlightIndex={0} />,
    )
    const textarea = editorTextarea()
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 960 })
    const mirror = editorMirror(container)
    patchRect(mirror, markRect(0, 0))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[0], markRect(0, 0))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: startIdx, endIndex: startEnd }]} activeHighlightIndex={0} revealNonce={1} />,
    )
    expect(textarea.scrollTop).toBe(0)
  })

  it('leaves the scroll position alone while typing away from the active match', () => {
    const value = 'needle\n' + Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')

    const { container, rerender } = render(
      <CodeEditor value={value} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 0, endIndex: 6 }]} activeHighlightIndex={0} />,
    )
    const textarea = editorTextarea()
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 960 })
    const mirror = editorMirror(container)
    patchRect(mirror, markRect(0, 960))
    patchRect(requireHtmlElement(container, 'mark'), markRect(0, 24))

    textarea.scrollTop = 500
    mirror.scrollTop = 500

    rerender(
      <CodeEditor value={`${value}\ntrailing`} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: 0, endIndex: 6 }]} activeHighlightIndex={0} />,
    )

    expect(textarea.scrollTop).toBe(500)
    expect(mirror.scrollTop).toBe(500)
  })
})
