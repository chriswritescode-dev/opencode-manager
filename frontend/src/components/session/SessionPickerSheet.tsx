import { useState } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { SessionPickerPanel } from '@/components/session/SessionPickerDialog'
import { useSessionPickerRouteScope } from '@/hooks/useSessionPickerRouteScope'
import { useSessionPickerLocationPrefetch } from '@/hooks/useSessionPickerLocationPrefetch'
import { useSessionPickerNavigation } from '@/hooks/useSessionPickerNavigation'

interface SessionPickerSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionPickerSheet({ isOpen, onClose }: SessionPickerSheetProps) {
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const { currentRepo, activeSessionID, remote } = useSessionPickerRouteScope(isOpen)
  const pickerNavigation = useSessionPickerNavigation({ mode: 'replace', onClose })
  useSessionPickerLocationPrefetch()

  const panel = isOpen ? (
    <SessionPickerPanel
      open={isOpen}
      currentRepo={currentRepo}
      activeSessionID={activeSessionID}
      {...pickerNavigation}
      remote={remote}
      searchTrailing={<LinkedServersNav variant="header" />}
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
