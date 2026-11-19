import { createContext, useContext } from 'react'
import { useMatch } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'

export const OpenCodeServerContext = createContext<string>(LOCAL_OPENCODE_SERVER_ID)

export function isLocalOpenCodeServer(serverId: string): boolean {
  return serverId === LOCAL_OPENCODE_SERVER_ID
}

export function useOpenCodeServerId(): string {
  return useContext(OpenCodeServerContext)
}

export function useRouteOpenCodeServerId(): string {
  const match = useMatch('/servers/:serverId/*')
  return match?.params.serverId ?? LOCAL_OPENCODE_SERVER_ID
}
