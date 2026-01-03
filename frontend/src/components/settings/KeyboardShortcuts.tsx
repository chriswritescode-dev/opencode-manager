import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useMobile } from '@/hooks/useMobile'
import { Loader2, X } from 'lucide-react'
import { DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl'

const normalizeShortcut = (shortcut: string): string => {
  return shortcut.replace(/Cmd/g, CMD_KEY)
}

const DEFAULT_DIRECT_SHORTCUTS = ['submit', 'abort']

export function KeyboardShortcuts() {
  const { preferences, isLoading, updateSettings } = useSettings()
  const isMobile = useMobile()
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [recordingLeader, setRecordingLeader] = useState(false)
  const [tempShortcuts, setTempShortcuts] = useState<Record<string, string>>({})
  const [tempLeaderKey, setTempLeaderKey] = useState<string | null>(null)
  const [currentKeys, setCurrentKeys] = useState<string>('')

  const leaderKey = tempLeaderKey ?? preferences?.leaderKey ?? DEFAULT_LEADER_KEY
  const directShortcuts = preferences?.directShortcuts ?? DEFAULT_DIRECT_SHORTCUTS

  const shortcuts = useMemo(() => ({ 
    ...DEFAULT_KEYBOARD_SHORTCUTS, 
    ...preferences?.keyboardShortcuts, 
    ...tempShortcuts 
  }), [preferences?.keyboardShortcuts, tempShortcuts])

  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

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

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      
      const keys = []
      if (e.ctrlKey) keys.push('Ctrl')
      if (e.metaKey) keys.push('Cmd')
      if (e.altKey) keys.push('Alt')
      if (e.shiftKey) keys.push('Shift')
      
      const mainKey = e.key
      if (!['Control', 'Meta', 'Alt', 'Shift'].includes(mainKey)) {
        let displayKey = mainKey
        if (mainKey === ' ') displayKey = 'Space'
        else if (mainKey === 'ArrowUp') displayKey = 'Up'
        else if (mainKey === 'ArrowDown') displayKey = 'Down'
        else if (mainKey === 'ArrowLeft') displayKey = 'Left'
        else if (mainKey === 'ArrowRight') displayKey = 'Right'
        else if (mainKey === 'Enter') displayKey = 'Return'
        else if (mainKey === 'Escape') displayKey = 'Esc'
        else if (mainKey === 'Tab') displayKey = 'Tab'
        else if (mainKey === 'Backspace') displayKey = 'Backspace'
        else if (mainKey === 'Delete') displayKey = 'Delete'
        else if (mainKey.length === 1) displayKey = mainKey.toUpperCase()
        
        keys.push(displayKey)
        
        if (keys.length > 0) {
          const shortcut = keys.join('+')
          
          if (recordingLeader) {
            setTempLeaderKey(shortcut)
            setRecordingLeader(false)
            setCurrentKeys('')
            updateSettingsRef.current({ leaderKey: shortcut })
          } else if (recordingKey) {
            setTempShortcuts(prev => ({ ...prev, [recordingKey]: shortcut }))
            setRecordingKey(null)
            setCurrentKeys('')
            updateSettingsRef.current({
              keyboardShortcuts: { ...shortcutsRef.current, [recordingKey]: shortcut }
            })
          }
        }
      } else {
        setCurrentKeys(keys.join('+'))
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
        setCurrentKeys('')
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
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
      <h2 className="text-lg font-semibold text-foreground mb-6">Keyboard Shortcuts</h2>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div className="space-y-1">
            <p className="text-foreground font-medium">Leader Key</p>
            <p className="text-xs text-muted-foreground">Press this first, then the shortcut key</p>
          </div>
          
          {recordingLeader ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="px-3 py-1.5 bg-accent border border-primary rounded text-sm text-foreground font-mono outline-none"
                placeholder="Press keys..."
                value={currentKeys || ''}
                autoFocus
                onBlur={stopRecording}
                readOnly
              />
              <button
                onClick={stopRecording}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={startRecordingLeader}
              className="px-3 py-1.5 bg-primary/20 border border-primary/50 hover:border-primary rounded text-sm text-foreground font-mono transition-colors"
            >
              {normalizeShortcut(leaderKey)}
            </button>
          )}
        </div>

        {Object.entries(shortcuts).map(([action, keys]) => (
          <div key={action} className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="space-y-1">
              <p className="text-foreground font-medium capitalize">
                {action.replace(/([A-Z])/g, ' $1').trim()}
              </p>
              <button
                onClick={() => toggleDirectShortcut(action)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {directShortcuts.includes(action) ? 'Direct (click to require leader)' : 'Requires leader key (click to make direct)'}
              </button>
            </div>
            
            {recordingKey === action ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="px-3 py-1.5 bg-accent border border-primary rounded text-sm text-foreground font-mono outline-none"
                  placeholder="Press keys..."
                  value={currentKeys || ''}
                  autoFocus
                  onBlur={stopRecording}
                  readOnly
                />
                <button
                  onClick={stopRecording}
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => startRecording(action)}
                  className={`px-3 py-1.5 bg-accent border border-border hover:border-border rounded text-sm font-mono transition-colors ${keys ? 'text-foreground' : 'text-muted-foreground italic'}`}
                >
                  {formatShortcutDisplay(action, keys)}
                </button>
                {keys && (
                  <button
                    onClick={() => clearShortcut(action)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="Clear shortcut"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Click on any shortcut to record a new key combination. Click on the status text below each action to toggle whether it requires the leader key.
      </p>
    </div>
  )
}
