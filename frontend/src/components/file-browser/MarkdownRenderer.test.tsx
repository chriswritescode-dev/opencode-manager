import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('toggles a task list item in the source content', () => {
    const onContentChange = vi.fn()
    render(<MarkdownRenderer content={'- [ ] first\n- [x] second'} onContentChange={onContentChange} />)

    const [first, second] = screen.getAllByRole('checkbox')
    expect(first).not.toBeChecked()
    expect(first).toBeEnabled()
    expect(second).toBeChecked()

    fireEvent.click(first!)
    expect(onContentChange).toHaveBeenCalledWith('- [x] first\n- [x] second')
  })

  it('strips unsafe raw HTML from a repository file and keeps safe HTML', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'# Readme\n\n<script>document.documentElement.dataset.fileProbe = 1</script>\n\n<p align="center"><img src="docs/logo.png" alt="Logo"></p>'}
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(document.documentElement.dataset.fileProbe).toBeUndefined()
    expect(screen.getByAltText('Logo')).toHaveAttribute('src', 'docs/logo.png')
  })
})
