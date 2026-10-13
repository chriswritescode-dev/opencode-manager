import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineImage } from './inline-image'

describe('InlineImage', () => {
  it('opens a full-size dialog when the thumbnail is clicked', () => {
    render(<InlineImage src="data:image/png;base64,aGVsbG8=" alt="shot.png" />)

    const thumbnail = screen.getByAltText('shot.png')
    expect(thumbnail).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')

    fireEvent.click(screen.getByRole('button', { name: 'Expand image: shot.png' }))

    expect(screen.getAllByAltText('shot.png')).toHaveLength(2)
  })

  it('falls back to the alt text when the image fails to load', () => {
    render(<InlineImage src="broken" alt="shot.png" />)

    fireEvent.error(screen.getByAltText('shot.png'))

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('shot.png')).toBeInTheDocument()
  })
})
