import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ScheduleRunMarkdown } from './ScheduleRunMarkdown'

describe('ScheduleRunMarkdown links', () => {
  it('opens local file links through the callback instead of navigating', () => {
    const onOpenLocalPath = vi.fn()
    render(<ScheduleRunMarkdown content="[Report](recaps/daily.html)" onOpenLocalPath={onOpenLocalPath} />)

    const link = screen.getByRole('link', { name: 'Report' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, event)

    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLocalPath).toHaveBeenCalledWith('recaps/daily.html')
  })

  it('opens external links in a new tab', () => {
    render(<ScheduleRunMarkdown content="[Docs](https://example.com)" onOpenLocalPath={vi.fn()} />)

    const link = screen.getByRole('link', { name: 'Docs' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('strips unsafe raw HTML from generated prose', () => {
    const payload =
      '<iframe srcdoc="&lt;script&gt;parent.document.documentElement.dataset.scheduleProbe = 1&lt;/script&gt;"></iframe><img src="x" onerror="document.documentElement.dataset.scheduleProbe = 2">'
    const { container } = render(<ScheduleRunMarkdown content={`Before\n\n${payload}\n\nAfter`} />)

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull()
    expect(document.documentElement.dataset.scheduleProbe).toBeUndefined()
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('renders safe raw HTML', () => {
    const { container } = render(
      <ScheduleRunMarkdown content={'<details><summary>More</summary>Hidden body</details>\n\nPress <kbd>Enter</kbd>'} />,
    )

    expect(container.querySelector('details summary')?.textContent).toBe('More')
    expect(screen.getByText('Enter').tagName).toBe('KBD')
  })

  it('keeps syntax highlighting after sanitization', () => {
    const { container } = render(<ScheduleRunMarkdown content={'```ts\nconst a = 1\n```'} />)

    const code = container.querySelector('pre code')
    expect(code?.className).toContain('language-ts')
    expect(code?.className).toContain('hljs')
    expect(code?.querySelector('[class^="hljs-"]')).not.toBeNull()
  })

  it('still renders GFM formatting', () => {
    render(<ScheduleRunMarkdown content="**bold** and `code`" onOpenLocalPath={vi.fn()} />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })
})
