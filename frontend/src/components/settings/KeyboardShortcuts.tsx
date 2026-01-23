import { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2 } from 'lucide-react'
import { DEFAULT_KEYBOARD_SHORTCUTS } from '@/api/types/settings'

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl'

const normalizeShortcut = (shortcut: string): string => {
  return shortcut.replace(/Cmd/g, CMD_KEY)
}

export function KeyboardShortcuts() {
  const { preferences, isLoading, updateSettings } = useSettings()
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [tempShortcuts, setTempShortcuts] = useState<Record<string, string>>({})
  const [currentKeys, setCurrentKeys] = useState<string>('')

  const shortcuts = useMemo(
    () => ({ ...DEFAULT_KEYBOARD_SHORTCUTS, ...preferences?.keyboardShortcuts, ...tempShortcuts }),
    [preferences?.keyboardShortcuts, tempShortcuts]
  )

  const startRecording = (action: string) => {
    setRecordingKey(action)
    setCurrentKeys('')
  }

  const stopRecording = () => {
    setRecordingKey(null)
    setCurrentKeys('')
  }

  useEffect(() => {
    if (recordingKey) {
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
            setTempShortcuts(prev => ({ ...prev, [recordingKey]: shortcut }))
            setRecordingKey(null)
            setCurrentKeys('')
            
            updateSettings({
              keyboardShortcuts: { ...shortcuts, [recordingKey]: shortcut }
            })
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
    }
  }, [recordingKey, shortcuts, updateSettings])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Keyboard Shortcuts</h2>
      
      <div className="space-y-4">
        {Object.entries(shortcuts).map(([action, keys]) => (
          <div key={action} className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="space-y-1">
              <p className="text-foreground font-medium capitalize">
                {action.replace(/([A-Z])/g, ' $1').trim()}
              </p>
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
              <button
                onClick={() => startRecording(action)}
                className="px-3 py-1.5 bg-accent border border-border hover:border-border rounded text-sm text-foreground font-mono transition-colors"
              >
                {normalizeShortcut(keys)}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Click on any shortcut to record a new key combination
      </p>
    </div>
  )
}
