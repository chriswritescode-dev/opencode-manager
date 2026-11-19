import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { SessionPickerPanel } from '@/components/session/SessionPickerDialog'
import type { SessionPickerNavigation } from '@/hooks/useSessionPickerNavigation'
import { useSessionPickerRouteScope } from '@/hooks/useSessionPickerRouteScope'

export interface RouteSessionPickerProps {
  navigation: SessionPickerNavigation
  onAddRepo?: () => void
}

export function RouteSessionPicker({ navigation, onAddRepo }: RouteSessionPickerProps) {
  const { currentRepo, activeSessionID, remote } = useSessionPickerRouteScope(true)

  return (
    <SessionPickerPanel
      open
      currentRepo={currentRepo}
      activeSessionID={activeSessionID}
      {...navigation}
      remote={remote}
      searchTrailing={<LinkedServersNav variant="header" />}
      onAddRepo={onAddRepo}
    />
  )
}
