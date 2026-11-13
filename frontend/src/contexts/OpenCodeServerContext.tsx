import type { ReactNode } from 'react'
import { OpenCodeServerContext } from './opencode-server-context'

export function OpenCodeServerProvider({
  serverId,
  children,
}: {
  serverId: string
  children: ReactNode
}) {
  return <OpenCodeServerContext.Provider value={serverId}>{children}</OpenCodeServerContext.Provider>
}
