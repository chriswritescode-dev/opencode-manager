import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { ModelCombobox } from '@/components/model/ModelCombobox'

const AUTOSAVE_DELAY_MS = 800

export function WalkthroughSettings() {
  const { preferences, updateSettings } = useSettings()
  const storedWalkthroughModel = preferences?.walkthroughModel

  const [walkthroughModel, setWalkthroughModel] = useState(storedWalkthroughModel ?? '')
  const committed = useRef(storedWalkthroughModel)

  useEffect(() => {
    setWalkthroughModel(storedWalkthroughModel ?? '')
    committed.current = storedWalkthroughModel
  }, [storedWalkthroughModel])

  const commitWalkthroughModel = useCallback(() => {
    const next = walkthroughModel.trim()
    if (next === (committed.current ?? '')) return
    committed.current = next
    updateSettings({ walkthroughModel: next })
  }, [walkthroughModel, updateSettings])

  useEffect(() => {
    const timer = setTimeout(() => {
      commitWalkthroughModel()
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [commitWalkthroughModel])

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Change walkthrough</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="walkthroughModel">Walkthrough model</Label>
          <p className="text-sm text-muted-foreground">
            Model that writes change walkthroughs. A small, fast model works well. Leave empty to use the session's model, or the OpenCode default.
          </p>
        </div>
        <ModelCombobox
          id="walkthroughModel"
          ariaLabel="Walkthrough model"
          value={walkthroughModel}
          onChange={setWalkthroughModel}
          placeholder="Session model"
          allowCustomValue
          showClear
          className="w-full shrink-0 sm:w-64"
        />
      </div>
    </div>
  )
}
