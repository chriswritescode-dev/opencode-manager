import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextPart } from './TextPart'

describe('TextPart code blocks', () => {
  it('reserves room for the copy button so the first code line is not covered', () => {
    const { container } = render(<TextPart text={'```ts\nconst answer = 42\n```'} />)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre).toHaveClass('pr-10')
    expect(screen.getByTitle('Copy code')).toBeInTheDocument()
    expect(pre?.textContent).toContain('const answer = 42')
  })
})
