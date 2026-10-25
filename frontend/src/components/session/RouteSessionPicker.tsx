import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { SessionPickerPanel } from '@/components/session/SessionPickerDialog'
import type { SessionPickerNavigation } from '@/hooks/useSessionPickerNavigation'
import { useSessionPickerRouteScope } from '@/hooks/useSessionPickerRouteScope'

export interface RouteSessionPickerProps {
  /** Session and repo handlers built by the host, so choosing a row navigates the same way it hosts. */
  navigation: SessionPickerNavigation
  /**
   * Replaces the panel's internal add-repo dialog with the host's own, letting the host close itself
   * first. When omitted the panel opens its own dialog.
   */
  onAddRepo?: () => void
}

/**
 * Session picker scoped to the route in view, including the linked-server selector. Hosts mount it
 * only while visible, so the route scope resolves repos and the remote server only then.
 */
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
