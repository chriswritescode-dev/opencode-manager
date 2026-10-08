import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useMobile } from '@/hooks/useMobile'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'
import { formatEventModifiers, formatShortcutEvent, isModifierOnlyEvent, normalizeShortcut, resolveDirectShortcuts } from '@/lib/keyboardShortcuts'
import { applyTuiKeybindImport, parseTuiKeybindConfig } from '@/lib/tuiKeybindImport'
import { showToast } from '@/lib/toast'

const CONVERSATION_ACTIONS = ['submit', 'abort', 'clearPrompt', 'toggleMode', 'undo', 'redo', 'compact', 'fork', 'timeline', 'exportSession', 'selectModel', 'variantCycle', 'halfPageUp', 'halfPageDown']
const NAVIGATION_ACTIONS = ['settings', 'sessions', 'newSession', 'closeSession', 'toggleSidebar', 'toggleTerminal', 'toggleSourceControl']

const formatShortcutLabel = (action: string): string => {
  return action.replace(/([A-Z])/g, ' $1').trim()
}

interface ShortcutGroup {
  title: string
  actions: string[]
}

const MAX_SKIPPED_IN_TOAST = 5

const buildSkippedDescription = (skipped: Array<{ name: string; reason: string }>): string | undefined => {
  if (skipped.length === 0) return undefined
  const shown = skipped.slice(0, MAX_SKIPPED_IN_TOAST).map((entry) => `${entry.name} (${entry.reason})`).join(', ')
  const remaining = skipped.length - MAX_SKIPPED_IN_TOAST
  return remaining > 0 ? `${shown} and ${remaining} more` : shown
}

const buildShortcutGroups = (shortcuts: Record<string, string>): ShortcutGroup[] => {
  const knownActions = new Set([...CONVERSATION_ACTIONS, ...NAVIGATION_ACTIONS])
  const unknownActions = Object.keys(shortcuts).filter((action) => !knownActions.has(action))
  return [
    {
      title: 'Conversation actions',
      actions: CONVERSATION_ACTIONS.filter((action) => action in shortcuts),
    },
    {
      title: 'Navigation',
      actions: [...NAVIGATION_ACTIONS.filter((action) => action in shortcuts), ...unknownActions],
    },
  ]
}

interface RecordingInputProps {
  value: string
  onStop: () => void
}

function RecordingInput({ value, onStop }: RecordingInputProps) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <input
        type="text"
        className="min-w-0 w-44 px-3 py-1.5 bg-accent border border-primary rounded text-[16px] md:text-sm text-foreground font-mono outline-none"
        placeholder="Press keys..."
        value={value || ''}
        autoFocus
        onBlur={onStop}
        readOnly
      />
      <button
        onClick={onStop}
        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  )
}

interface ShortcutRowProps {
  action: string
  keys: string
  isDirect: boolean
  display: string
  isRecording: boolean
  currentKeys: string
  onToggleDirect: (action: string) => void
  onStartRecording: (action: string) => void
  onStopRecording: () => void
  onClear: (action: string) => void
}

function ShortcutRow({ action, keys, isDirect, display, isRecording, currentKeys, onToggleDirect, onStartRecording, onStopRecording, onClear }: ShortcutRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0 flex-1 basis-48 space-y-0.5">
        <p className="truncate text-sm font-medium capitalize text-foreground">{formatShortcutLabel(action)}</p>
        <button
          onClick={() => onToggleDirect(action)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          {isDirect ? 'Direct (click to require leader)' : 'Requires leader key (click to make direct)'}
        </button>
      </div>

      {isRecording ? (
        <RecordingInput value={currentKeys} onStop={onStopRecording} />
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStartRecording(action)}
            className={`px-3 py-1.5 bg-accent border border-border hover:border-border rounded text-sm font-mono transition-colors ${keys ? 'text-foreground' : 'text-muted-foreground italic'}`}
          >
            {display}
          </button>
          {keys && (
            <button
              onClick={() => onClear(action)}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title="Clear shortcut"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function KeyboardShortcuts() {
  const { preferences, isLoading, updateSettings } = useSettings()
  const isMobile = useMobile()
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [recordingLeader, setRecordingLeader] = useState(false)
  const [tempShortcuts, setTempShortcuts] = useState<Record<string, string>>({})
  const [tempLeaderKey, setTempLeaderKey] = useState<string | null>(null)
  const [currentKeys, setCurrentKeys] = useState<string>('')

  const leaderKey = tempLeaderKey ?? preferences?.leaderKey ?? DEFAULT_LEADER_KEY
  const directShortcuts = resolveDirectShortcuts(preferences?.directShortcuts, preferences?.keyboardShortcuts)

  const shortcuts = useMemo<Record<string, string>>(() => ({
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    ...preferences?.keyboardShortcuts,
    ...tempShortcuts
  }), [preferences?.keyboardShortcuts, tempShortcuts])

  const shortcutGroups = useMemo(() => buildShortcutGroups(shortcuts), [shortcuts])

  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const leaderKeyRef = useRef(leaderKey)
  leaderKeyRef.current = leaderKey

  const directShortcutsRef = useRef(directShortcuts)
  directShortcutsRef.current = directShortcuts

  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

  const fileInputRef = useRef<HTMLInputElement>(null)

  const startRecording = (action: string) => {
    setRecordingKey(action)
    setRecordingLeader(false)
    setCurrentKeys('')
  }

  const startRecordingLeader = () => {
    setRecordingLeader(true)
    setRecordingKey(null)
    setCurrentKeys('')
  }

  const stopRecording = useCallback(() => {
    setRecordingKey(null)
    setRecordingLeader(false)
    setCurrentKeys('')
  }, [])

  const clearShortcut = useCallback((action: string) => {
    setTempShortcuts(prev => ({ ...prev, [action]: '' }))
    updateSettingsRef.current({
      keyboardShortcuts: { ...shortcutsRef.current, [action]: '' }
    })
  }, [])

  useEffect(() => {
    if (!recordingKey && !recordingLeader) return

    let leaderPressed = false
    const leaderPrefix = () => (leaderPressed ? `${normalizeShortcut(leaderKeyRef.current)} → ` : '')

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const shortcut = formatShortcutEvent(e)
      if (!shortcut) {
        setCurrentKeys(leaderPrefix() + formatEventModifiers(e))
        return
      }

      if (recordingLeader) {
        setTempLeaderKey(shortcut)
        setRecordingLeader(false)
        setCurrentKeys('')
        updateSettingsRef.current({ leaderKey: shortcut })
        return
      }

      if (!recordingKey) return

      if (!leaderPressed && shortcut === normalizeShortcut(leaderKeyRef.current)) {
        leaderPressed = true
        setCurrentKeys(leaderPrefix())
        return
      }

      const otherDirectShortcuts = directShortcutsRef.current.filter((action) => action !== recordingKey)
      setTempShortcuts(prev => ({ ...prev, [recordingKey]: shortcut }))
      setRecordingKey(null)
      setCurrentKeys('')
      updateSettingsRef.current({
        keyboardShortcuts: { ...shortcutsRef.current, [recordingKey]: shortcut },
        directShortcuts: leaderPressed ? otherDirectShortcuts : [...otherDirectShortcuts, recordingKey],
      })
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isModifierOnlyEvent(e)) {
        setCurrentKeys(leaderPrefix())
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [recordingKey, recordingLeader])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const formatShortcutDisplay = (action: string, keys: string) => {
    if (!keys) return 'Not set'
    if (directShortcuts.includes(action)) {
      return normalizeShortcut(keys)
    }
    return `${normalizeShortcut(leaderKey)} → ${normalizeShortcut(keys)}`
  }

  const toggleDirectShortcut = (action: string) => {
    const newDirectShortcuts = directShortcuts.includes(action)
      ? directShortcuts.filter(s => s !== action)
      : [...directShortcuts, action]
    updateSettings({ directShortcuts: newDirectShortcuts })
  }

  const importFromTui = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const imported = parseTuiKeybindConfig(await file.text())
      stopRecording()
      const applied = applyTuiKeybindImport(imported, {
        keyboardShortcuts: shortcutsRef.current,
        directShortcuts: directShortcutsRef.current,
      })
      const importedCount = Object.keys(imported.shortcuts).length + (applied.leaderKey ? 1 : 0)
      const skippedDescription = buildSkippedDescription(imported.skipped)

      if (importedCount === 0) {
        showToast.info(
          `No matching shortcuts found in ${file.name}`,
          skippedDescription ? { description: skippedDescription } : undefined,
        )
        return
      }

      updateSettingsRef.current({
        keyboardShortcuts: applied.keyboardShortcuts,
        directShortcuts: applied.directShortcuts,
        ...(applied.leaderKey ? { leaderKey: applied.leaderKey } : {}),
      })
      setTempShortcuts(applied.keyboardShortcuts)
      if (applied.leaderKey !== undefined) {
        setTempLeaderKey(applied.leaderKey)
      }

      const description = [
        applied.cleared.length > 0 ? `Unbound to avoid conflicts: ${applied.cleared.map((action) => formatShortcutLabel(action).toLowerCase()).join(', ')}` : undefined,
        skippedDescription ? `Skipped: ${skippedDescription}` : undefined,
      ].filter(Boolean).join('. ')
      showToast.success(
        `Imported ${importedCount} shortcut${importedCount === 1 ? '' : 's'} from ${file.name}`,
        description ? { description } : undefined,
      )
    } catch (error) {
      showToast.error('Could not import shortcuts', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  if (isMobile) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Keyboard Shortcuts</h2>
        <p className="text-sm text-muted-foreground">
          Keyboard shortcuts are not available on mobile devices.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>

        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Import from OpenCode TUI
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonc,application/json"
            className="hidden"
            onChange={importFromTui}
          />
          <p className="text-xs text-muted-foreground text-right">
            Select your OpenCode cli.json (or legacy tui.json), usually in ~/.config/opencode.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-medium text-foreground">Leader Key</p>
          <p className="text-xs text-muted-foreground">Press this first, then the shortcut key</p>
        </div>

        {recordingLeader ? (
          <RecordingInput value={currentKeys} onStop={stopRecording} />
        ) : (
          <button
            onClick={startRecordingLeader}
            className="px-3 py-1.5 bg-primary/20 border border-primary/50 hover:border-primary rounded text-sm text-foreground font-mono transition-colors"
          >
            {normalizeShortcut(leaderKey)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 pt-4 @min-[1000px]:grid-cols-2 @min-[1000px]:items-start">
        {shortcutGroups.map((group) => (
          <section key={group.title} className="min-w-0" aria-label={group.title}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
            <div>
              {group.actions.map((action) => (
                <ShortcutRow
                  key={action}
                  action={action}
                  keys={shortcuts[action] ?? ''}
                  isDirect={directShortcuts.includes(action)}
                  display={formatShortcutDisplay(action, shortcuts[action] ?? '')}
                  isRecording={recordingKey === action}
                  currentKeys={currentKeys}
                  onToggleDirect={toggleDirectShortcut}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  onClear={clearShortcut}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Click on any shortcut to record a new key combination. Press the leader key first to record a leader shortcut, or press a combination directly to record a direct one. Click on the status text below each action to toggle whether it requires the leader key.
      </p>
    </div>
  )
}
