/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import type { KeyboardShortcutAction } from '@/api/types/settings'
import { findShortcutAction, formatShortcutEvent, hasCommandModifier, resolveShortcutBindings } from '@/lib/keyboardShortcuts'
import { isPromptInput, isTextEntryElement } from '@/lib/domTargets'
import { hasOpenOverlay } from '@/lib/overlayFocus'

const LEADER_TIMEOUT = 2000

export type ShortcutActions = Partial<Record<KeyboardShortcutAction, () => void>>

interface ShortcutLayer {
  actionsRef: { current: ShortcutActions }
}

interface ShortcutRegistry {
  global: ShortcutLayer[]
  page: ShortcutLayer[]
}

const KeyboardShortcutsRegistryContext = createContext<ShortcutRegistry | null>(null)

const PROMPT_ONLY_DIRECT_ACTIONS: ReadonlySet<string> = new Set(['toggleMode', 'clearPrompt'])

const HALF_PAGE_DIRECT_ACTIONS: ReadonlySet<string> = new Set(['halfPageUp', 'halfPageDown'])

function typesCharacter(shortcut: string): boolean {
  return !hasCommandModifier(shortcut) && /(^|\+).$/.test(shortcut)
}

/**
 * Whether a direct shortcut may run for this focus target. Prompt-only actions (agent cycling, prompt clearing) run only
 * from the prompt and never on a key that types a character. `submit` runs only from the prompt, so a submit bound to
 * plain Enter sends the prompt without hijacking Enter on buttons or other fields. Half-page scrolling runs only from the
 * prompt or a non-text target, so it never hijacks Ctrl+U/Ctrl+D inside another text field. `abort` runs from the prompt
 * or with no text field focused; other text inputs only accept modified shortcuts.
 */
function isDirectActionAllowed(action: string, shortcut: string, target: HTMLElement): boolean {
  if (PROMPT_ONLY_DIRECT_ACTIONS.has(action)) return isPromptInput(target) && !typesCharacter(shortcut)
  if (action === 'submit') return isPromptInput(target)
  if (HALF_PAGE_DIRECT_ACTIONS.has(action)) return isPromptInput(target) || !isTextEntryElement(target)
  if (!isTextEntryElement(target)) return true
  if (action === 'abort') return isPromptInput(target)
  return hasCommandModifier(shortcut)
}

function isTerminalTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-terminal-id]') !== null
}

function findLayerHandler(layers: ShortcutLayer[], action: string): (() => void) | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const handler = layers[index].actionsRef.current[action as KeyboardShortcutAction]
    if (handler) return handler
  }
  return undefined
}

function findHandler(registry: ShortcutRegistry, action: string): (() => void) | undefined {
  return findLayerHandler(registry.page, action) ?? findLayerHandler(registry.global, action)
}

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const { preferences } = useSettings()
  const [leaderActive, setLeaderActive] = useState(false)
  const leaderActiveRef = useRef(false)
  const leaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const registryRef = useRef<ShortcutRegistry>({ global: [], page: [] })

  const setLeader = useCallback((active: boolean) => {
    if (leaderTimeoutRef.current) {
      clearTimeout(leaderTimeoutRef.current)
      leaderTimeoutRef.current = null
    }
    leaderActiveRef.current = active
    setLeaderActive(active)
    if (!active) return
    leaderTimeoutRef.current = setTimeout(() => {
      leaderTimeoutRef.current = null
      leaderActiveRef.current = false
      setLeaderActive(false)
    }, LEADER_TIMEOUT)
  }, [])

  const runAction = useCallback((action: string | undefined, e: KeyboardEvent): boolean => {
    if (!action) return false
    if (action === 'abort' && hasOpenOverlay()) return false
    const handler = findHandler(registryRef.current, action)
    if (!handler) return false
    e.preventDefault()
    handler()
    return true
  }, [])

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent): boolean => {
      if (e.defaultPrevented || e.isComposing) return false
      const shortcut = formatShortcutEvent(e)
      if (!shortcut) return false

      const target = e.target as HTMLElement
      if (target.closest?.('[data-file-editor="true"]')) return false

      const bindings = resolveShortcutBindings(preferencesRef.current)

      if (leaderActiveRef.current) {
        setLeader(false)
        return runAction(findShortcutAction(bindings, shortcut, false), e)
      }

      if (shortcut === bindings.leaderKey && (!isTextEntryElement(target) || hasCommandModifier(shortcut))) {
        e.preventDefault()
        setLeader(true)
        return true
      }

      const directAction = findShortcutAction(bindings, shortcut, true)
      if (!directAction) return false
      if (isTerminalTarget(e.target) && directAction !== 'toggleTerminal') return false
      if (!isDirectActionAllowed(directAction, shortcut, target)) return false
      return runAction(directAction, e)
    }

    const handleTerminalKeyDown = (e: KeyboardEvent) => {
      if (!isTerminalTarget(e.target) || !handleShortcut(e)) return
      e.stopPropagation()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTerminalTarget(e.target)) return
      handleShortcut(e)
    }

    document.addEventListener('keydown', handleTerminalKeyDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleTerminalKeyDown, true)
      document.removeEventListener('keydown', handleKeyDown)
      setLeader(false)
    }
  }, [runAction, setLeader])

  return (
    <KeyboardShortcutsRegistryContext.Provider value={registryRef.current}>
      {children}
      {leaderActive && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-primary/90 text-primary-foreground border border-primary shadow-lg backdrop-blur-md animate-pulse">
          <span className="text-sm font-medium">Waiting for shortcut key...</span>
        </div>
      )}
    </KeyboardShortcutsRegistryContext.Provider>
  )
}

/**
 * Registers a layer of shortcut handlers for the lifetime of the calling component. Page layers take precedence over global
 * layers, and within a scope the newest layer wins; an action left `undefined` in a layer falls through to lower layers.
 */
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
