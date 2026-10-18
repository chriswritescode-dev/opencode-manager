/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'
import { useMatch } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'

const OpenCodeServerContext = createContext<string>(LOCAL_OPENCODE_SERVER_ID)

export function isLocalOpenCodeServer(serverId: string): boolean {
  return serverId === LOCAL_OPENCODE_SERVER_ID
}

export function OpenCodeServerProvider({
  serverId,
  children,
}: {
  serverId: string
  children: React.ReactNode
}) {
  return <OpenCodeServerContext.Provider value={serverId}>{children}</OpenCodeServerContext.Provider>
}

export function useOpenCodeServerId(): string {
  return useContext(OpenCodeServerContext)
}

/**
 * Server id carried by the current route: the `serverId` of a `/servers/:serverId` route, or the
 * local server id everywhere else. For components rendered outside the server scope provider.
 */
export function useRouteOpenCodeServerId(): string {
  const match = useMatch('/servers/:serverId/*')
  return match?.params.serverId ?? LOCAL_OPENCODE_SERVER_ID
}
