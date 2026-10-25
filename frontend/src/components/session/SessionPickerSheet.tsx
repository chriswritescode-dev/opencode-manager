import { useState } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { RouteSessionPicker } from '@/components/session/RouteSessionPicker'
import { useSessionPickerLocationPrefetch } from '@/hooks/useSessionPickerLocationPrefetch'
import { useSessionPickerNavigation } from '@/hooks/useSessionPickerNavigation'

interface SessionPickerSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionPickerSheet({ isOpen, onClose }: SessionPickerSheetProps) {
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const pickerNavigation = useSessionPickerNavigation({ mode: 'replace', onClose })
  useSessionPickerLocationPrefetch()

  const panel = isOpen ? (
    <RouteSessionPicker
      navigation={pickerNavigation}
      onAddRepo={() => {
        onClose()
        setAddRepoOpen(true)
      }}
    />
  ) : null

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[90dvh]" ariaLabel="Sessions">
        {panel}
      </BottomSheet>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </>
  )
}
