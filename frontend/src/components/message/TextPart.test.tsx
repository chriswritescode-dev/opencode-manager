import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextPart } from './TextPart'

const mocks = vi.hoisted(() => ({
  useTheme: vi.fn(() => 'dark'),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => mocks.useTheme(),
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}))

const createTextPart = (text: string) => ({
  type: 'text' as const,
  text,
  sessionID: 'test-session',
  id: 'part-1',
})

describe('TextPart', () => {
  beforeEach(() => {
    mocks.useTheme.mockReturnValue('dark')
  })

  it('renders HTML fenced code block with artifact button', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = 'Here is a page:\n\n```html\n<html><body><h1>Hello artifact</h1></body></html>\n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    const button = screen.getByTitle('Preview HTML artifact')
    expect(button).toBeInTheDocument()
  })

  it('calls onHtmlArtifactOpen with correct data when artifact button is clicked', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = 'Here is a page:\n\n```html\n<html><body><h1>Hello artifact</h1></body></html>\n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    const button = screen.getByTitle('Preview HTML artifact')
    fireEvent.click(button)

    expect(onHtmlArtifactOpen).toHaveBeenCalledWith({
      source: 'inline',
      html: '<html><body><h1>Hello artifact</h1></body></html>',
      title: 'HTML artifact',
    })
  })

  it('does not show artifact button for non-HTML code blocks', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = '```ts\nconst x = 1\n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    expect(screen.queryByTitle('Preview HTML artifact')).not.toBeInTheDocument()
  })

  it('still shows copy button for code blocks', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = '```html\n<p>test</p>\n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    expect(screen.getByTitle('Copy code')).toBeInTheDocument()
  })

  it('preserves leading/trailing whitespace when copying code content', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = '```\n  const x = 1\n  \n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    const copyButton = screen.getByTitle('Copy code')
    expect(copyButton).toBeInTheDocument()
  })

  it('does not show artifact button for mermaid code blocks', () => {
    const onHtmlArtifactOpen = vi.fn()
    const markdown = '```mermaid\ngraph TD;\nA-->B;\n```'
    const part = createTextPart(markdown)

    render(<TextPart part={part} onHtmlArtifactOpen={onHtmlArtifactOpen} />)

    expect(screen.queryByTitle('Preview HTML artifact')).not.toBeInTheDocument()
  })
})
