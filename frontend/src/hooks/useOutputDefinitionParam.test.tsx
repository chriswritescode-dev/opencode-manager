import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { DEFAULT_OUTPUT_DEFINITION_ID } from '@opencode-manager/shared/schemas'
import { useOutputDefinitionParam } from './useOutputDefinitionParam'

function renderProbe(entry: string) {
  function Probe() {
    const [definitionId, setDefinitionId] = useOutputDefinitionParam()
    const location = useLocation()
    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'definition' }, definitionId),
      createElement('span', { 'data-testid': 'search' }, location.search),
      createElement('button', { type: 'button', onClick: () => setDefinitionId('summary') }, 'Choose summary'),
    )
  }

  render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Probe)))
}

describe('useOutputDefinitionParam', () => {
  it('defaults to the built-in output definition', () => {
    renderProbe('/repos/1/sessions/ses_1')

    expect(screen.getByTestId('definition')).toHaveTextContent(DEFAULT_OUTPUT_DEFINITION_ID)
  })

  it('reads the output definition from the URL', () => {
    renderProbe('/repos/1/sessions/ses_1?output=review')

    expect(screen.getByTestId('definition')).toHaveTextContent('review')
  })

  it('replaces the output param when the definition changes', async () => {
    renderProbe('/repos/1/sessions/ses_1?output=review')

    fireEvent.click(screen.getByRole('button', { name: 'Choose summary' }))

    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('output=summary'))
    expect(screen.getByTestId('definition')).toHaveTextContent('summary')
  })
})
