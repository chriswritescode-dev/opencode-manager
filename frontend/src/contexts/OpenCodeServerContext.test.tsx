import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useRouteOpenCodeServerId } from './OpenCodeServerContext'

function renderRouteServerId(pathname: string) {
  return renderHook(() => useRouteOpenCodeServerId(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>,
  })
}

describe('useRouteOpenCodeServerId', () => {
  it('reports the local server outside a linked-server route', () => {
    expect(renderRouteServerId('/').result.current).toBe(LOCAL_OPENCODE_SERVER_ID)
    expect(renderRouteServerId('/repos/1/sessions/ses_1').result.current).toBe(LOCAL_OPENCODE_SERVER_ID)
    expect(renderRouteServerId('/schedules').result.current).toBe(LOCAL_OPENCODE_SERVER_ID)
  })

  it('reports the server id of a linked-server route', () => {
    expect(renderRouteServerId('/servers/srv_kitchen').result.current).toBe('srv_kitchen')
  })

  it('reports the server id of a linked-server session route', () => {
    expect(renderRouteServerId('/servers/srv_kitchen/sessions/ses_remote').result.current).toBe('srv_kitchen')
  })
})
