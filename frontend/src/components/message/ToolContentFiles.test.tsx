import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ToolContentFiles } from './ToolContentFiles'

const partWithContent = (
  content: Extract<SessionMessageAssistantTool['state'], { status: 'completed' }>['content'],
): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'call_files',
  name: 'execute',
  time: { created: 1, ran: 2, completed: 3 },
  state: {
    status: 'completed',
    input: { code: 'await tools.screenshot()' },
    content,
  },
})

describe('ToolContentFiles', () => {
  it('renders an image data uri with the file name as alt text', () => {
    render(
      <ToolContentFiles
        part={partWithContent([
          { type: 'file', uri: 'data:image/png;base64,aGVsbG8=', mime: 'image/png', name: 'shot.png' },
        ])}
      />,
    )

    const image = screen.getByAltText('shot.png')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
  })

  it('falls back to the mime type for an unnamed image', () => {
    render(
      <ToolContentFiles
        part={partWithContent([
          { type: 'file', uri: 'https://example.test/shot.png', mime: 'image/png' },
        ])}
      />,
    )

    expect(screen.getByAltText('image/png')).toHaveAttribute('src', 'https://example.test/shot.png')
  })

  it('renders a chip for a non-image file and no image', () => {
    const { container } = render(
      <ToolContentFiles
        part={partWithContent([
          { type: 'file', uri: 'file:///tmp/report.pdf', mime: 'application/pdf', name: 'report.pdf' },
        ])}
      />,
    )

    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it.each(['javascript:alert(1)', 'file:///tmp/secret.png'])(
    'renders a chip instead of an image for the disallowed uri %s',
    (uri) => {
      const { container } = render(
        <ToolContentFiles
          part={partWithContent([{ type: 'file', uri, mime: 'image/png', name: 'secret.png' }])}
        />,
      )

      expect(screen.getByText('secret.png')).toBeInTheDocument()
      expect(container.querySelector('img')).toBeNull()
    },
  )

  it('renders text-only content as nothing', () => {
    const { container } = render(
      <ToolContentFiles part={partWithContent([{ type: 'text', text: 'no files here' }])} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a non-completed part', () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_running',
      name: 'execute',
      time: { created: 1, ran: 2 },
      state: { status: 'running', input: { code: 'await tools.screenshot()' }, metadata: {} },
    }

    const { container } = render(<ToolContentFiles part={part} />)

    expect(container).toBeEmptyDOMElement()
  })
})
