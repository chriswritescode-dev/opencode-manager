import { createContext, useContext, useEffect, useRef } from 'react'
import type { KeyboardShortcutAction } from '@/api/types/settings'

export type ShortcutActions = Partial<Record<KeyboardShortcutAction, () => void>>

type ShortcutHandlerMap = Readonly<Record<string, (() => void) | undefined>>

interface ShortcutLayer {
  actionsRef: { current: ShortcutHandlerMap }
}

export interface ShortcutRegistry {
  global: ShortcutLayer[]
  page: ShortcutLayer[]
}

export const KeyboardShortcutsRegistryContext = createContext<ShortcutRegistry | null>(null)

export function useShortcutActions(actions: ShortcutActions, scope: 'global' | 'page' = 'page'): void {
  const registry = useContext(KeyboardShortcutsRegistryContext)
  if (!registry) throw new Error('useShortcutActions must be used within a KeyboardShortcutsProvider')
  const layerRef = useRef<ShortcutLayer>({ actionsRef: { current: actions } })
  layerRef.current.actionsRef.current = actions

  useEffect(() => {
    const layers = scope === 'global' ? registry.global : registry.page
    const layer = layerRef.current
    layers.push(layer)
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
    }
  }, [registry, scope])
}
