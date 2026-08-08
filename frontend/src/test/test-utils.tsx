/* eslint-disable react-refresh/only-export-components */

import { useEffect, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

export function createRouterWrapper(initialEntries?: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

export function renderHookWithRouter<T>(renderFn: () => T, initialEntries?: string[]) {
  return renderHook(renderFn, { wrapper: createRouterWrapper(initialEntries) })
}

export function LocationCatcher({ capturedSearch }: { capturedSearch: { current: string } }) {
  const location = useLocation()
  useEffect(() => {
    capturedSearch.current = location.search
  })
  return null
}

export function renderHookWithRouterAndLocation<T>(renderFn: () => T, initialEntries?: string[]) {
  const capturedSearch: { current: string } = { current: '' }
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <LocationCatcher capturedSearch={capturedSearch} />
        {children}
      </MemoryRouter>
    )
  }
  const rendered = renderHook(renderFn, { wrapper })
  return { ...rendered, capturedSearch }
}
