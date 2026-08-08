import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodePreview } from './CodePreview'

const mocks = vi.hoisted(() => ({
  useMobile: vi.fn(() => false),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: () => mocks.useMobile(),
}))

describe('CodePreview', () => {
  beforeEach(() => {
    mocks.useMobile.mockReturnValue(false)
  })

  it('shows artifact button for .html files', () => {
    const onHtmlArtifactOpen = vi.fn()
    render(
      <CodePreview
        fileName="dist/report.html"
        content="<h1>Report</h1>"
        onHtmlArtifactOpen={onHtmlArtifactOpen}
      />
    )

    const button = screen.getByTitle('Preview HTML artifact')
    expect(button).toBeInTheDocument()
  })

  it('calls onHtmlArtifactOpen with file source when artifact button is clicked', () => {
    const onHtmlArtifactOpen = vi.fn()
    render(
      <CodePreview
        fileName="dist/report.html"
        content="<h1>Report</h1>"
        onHtmlArtifactOpen={onHtmlArtifactOpen}
      />
    )

    const button = screen.getByTitle('Preview HTML artifact')
    fireEvent.click(button)

    expect(onHtmlArtifactOpen).toHaveBeenCalledWith({
      source: 'file',
      path: 'dist/report.html',
      title: expect.stringContaining('report'),
    })
  })

  it('shows artifact button for .htm files', () => {
    const onHtmlArtifactOpen = vi.fn()
    render(
      <CodePreview
        fileName="page.htm"
        content="<h1>Hello</h1>"
        onHtmlArtifactOpen={onHtmlArtifactOpen}
      />
    )

    expect(screen.getByTitle('Preview HTML artifact')).toBeInTheDocument()
  })

  it('does not show artifact button for .ts files', () => {
    const onHtmlArtifactOpen = vi.fn()
    render(
      <CodePreview
        fileName="component.ts"
        content="const x = 1"
        onHtmlArtifactOpen={onHtmlArtifactOpen}
      />
    )

    expect(screen.queryByTitle('Preview HTML artifact')).not.toBeInTheDocument()
  })

  it('shows show-more button for large files', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    const content = lines.join('\n')

    render(
      <CodePreview
        fileName="large.ts"
        content={content}
      />
    )

    expect(screen.getByText(/10 more lines/)).toBeInTheDocument()
  })

  it('uses inline fallback when fileName is empty', () => {
    const onHtmlArtifactOpen = vi.fn()
    render(
      <CodePreview
        fileName=""
        content="<h1>Hello</h1>"
        onHtmlArtifactOpen={onHtmlArtifactOpen}
      />
    )

    const button = screen.getByTitle('Preview HTML artifact')
    fireEvent.click(button)

    expect(onHtmlArtifactOpen).toHaveBeenCalledWith({
      source: 'inline',
      html: '<h1>Hello</h1>',
      title: 'HTML artifact',
    })
  })
})
