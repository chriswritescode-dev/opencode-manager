import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeEditor } from './code-editor'

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

  it('omits the gutter when showLineNumbers is false', () => {
    const { container } = render(<CodeEditor value={'a\nb'} onChange={vi.fn()} showLineNumbers={false} ariaLabel="config" />)
    expect(container.querySelectorAll('[data-line-number]')).toHaveLength(0)
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
    const textarea = screen.getByLabelText('config')
    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
    for (const token of ['font-mono', 'text-[16px]', 'md:text-sm', 'leading-6', '[tab-size:2]', 'whitespace-pre-wrap', '[overflow-wrap:anywhere]', 'py-2', 'pr-3', 'pl-10', '[scrollbar-gutter:stable]']) {
      expect(textarea.className).toContain(token)
      expect(mirror.className).toContain(token)
    }
  })

  it('keeps the mirror hidden from assistive tech', () => {
    const { container } = render(<CodeEditor value={'a'} onChange={vi.fn()} ariaLabel="config" />)
    expect(container.querySelector('[data-editor-mirror]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('mirrors textarea scrolling', () => {
    const { container } = render(<CodeEditor value={'a\nb\nc'} onChange={vi.fn()} ariaLabel="config" />)
    const textarea = screen.getByLabelText('config') as HTMLTextAreaElement
    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
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
    expect(screen.getByLabelText('config').className).not.toContain('text-transparent')
    expect((container.querySelector('[data-editor-mirror]') as HTMLElement).className).toContain('text-transparent')

    rerender(<CodeEditor value={HIGHLIGHT_VALUE} onChange={vi.fn()} ariaLabel="config"
      highlights={[{ startIndex: 14, endIndex: 20 }]} activeHighlightIndex={0} />)
    expect(screen.getByLabelText('config').className).toContain('text-transparent')
    expect((container.querySelector('[data-editor-mirror]') as HTMLElement).className).not.toContain('text-transparent')
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
    const number = container.querySelector('[data-line="2"] [data-line-number]') as HTMLElement
    expect(number.className).toContain('text-destructive')
  })

  it('scrolls the active line into view', () => {
    const longValue = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const { container, rerender } = render(<CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config" />)
    const textarea = screen.getByLabelText('config') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 960 })
    const row = container.querySelector('[data-line="30"]') as HTMLElement
    Object.defineProperty(row, 'offsetTop', { configurable: true, value: 700 })
    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 24 })

    rerender(<CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config" activeLine={30} />)

    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
    expect(textarea.scrollTop).toBe(612)
    expect(mirror.scrollTop).toBe(612)
  })

  function rect(top: number, height: number): DOMRect {
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }

  function patchRect(target: Element, value: DOMRect) {
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => value,
    })
  }

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
    const textarea = screen.getByLabelText('config') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 1600 })
    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
    patchRect(mirror, rect(0, 1600))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[1], rect(1500, 24))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={1} />,
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
    const textarea = screen.getByLabelText('config') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 1600 })
    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
    patchRect(mirror, rect(0, 1600))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[0], rect(0, 24))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[
          { startIndex: startIdx, endIndex: startEnd },
          { startIndex: endIdx, endIndex: endEnd },
        ]} activeHighlightIndex={0} />,
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
    const textarea = screen.getByLabelText('config') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 960 })
    const mirror = container.querySelector('[data-editor-mirror]') as HTMLElement
    patchRect(mirror, rect(0, 0))
    const marks = container.querySelectorAll('mark')
    patchRect(marks[0], rect(0, 0))

    rerender(
      <CodeEditor value={longValue} onChange={vi.fn()} ariaLabel="config"
        highlights={[{ startIndex: startIdx, endIndex: startEnd }]} activeHighlightIndex={0} />,
    )
    expect(textarea.scrollTop).toBe(0)
  })
})
