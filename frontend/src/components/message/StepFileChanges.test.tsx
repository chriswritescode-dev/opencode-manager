import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepFileChanges } from './StepFileChanges'

describe('StepFileChanges', () => {
  it('renders the file count and relative paths', () => {
    render(
      <StepFileChanges
        files={['/workspace/repos/app/src/a.ts', '/workspace/repos/app/src/b.ts']}
        snapshot="0123456789abcdef"
      />,
    )

    expect(screen.getByText('File Changes (2 files)')).toBeInTheDocument()
    expect(screen.getByText('app/src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('app/src/b.ts')).toBeInTheDocument()
    expect(screen.getByText('01234567')).toBeInTheDocument()
  })

  it('calls onFileClick with the original path', () => {
    const onFileClick = vi.fn()
    render(<StepFileChanges files={['/workspace/repos/app/src/a.ts']} onFileClick={onFileClick} />)

    fireEvent.click(screen.getByText('app/src/a.ts'))

    expect(onFileClick).toHaveBeenCalledWith('/workspace/repos/app/src/a.ts')
  })

  it('collapses long lists and expands on demand', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']
    render(<StepFileChanges files={files} />)

    expect(screen.queryByText('d.ts')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('+2 more files'))
    expect(screen.getByText('e.ts')).toBeInTheDocument()
    expect(screen.getByText('Show less')).toBeInTheDocument()
  })

  it('renders nothing when there are no files', () => {
    const { container } = render(<StepFileChanges files={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
