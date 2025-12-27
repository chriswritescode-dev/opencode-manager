import { usePermissionContext } from '@/contexts/PermissionContext'
import { useMobile } from '@/hooks/useMobile'
import { Bell } from 'lucide-react'

export function GlobalPermissionNotification() {
  const { pendingCount, setShowDialog } = usePermissionContext()
  const isMobile = useMobile()

  if (pendingCount === 0) return null

  return (
    <button
      onClick={() => setShowDialog(true)}
      className={`fixed z-50 ${
        isMobile ? 'bottom-20 right-4' : 'top-4 right-4'
      } bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 border-2 border-orange-400/60 hover:border-orange-300 shadow-lg shadow-orange-500/40 hover:shadow-orange-500/60 ring-2 ring-orange-500/20 hover:ring-orange-500/40 text-white rounded-full transition-all duration-200 ${
        isMobile ? 'w-14 h-14' : 'w-12 h-12'
      } hover:scale-110 active:scale-95 flex items-center justify-center`}
      title={`${pendingCount} pending permission${pendingCount > 1 ? 's' : ''}`}
    >
      <Bell className="w-6 h-6" />
      {pendingCount > 0 && (
        <span
          className={`absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-background`}
        >
          {pendingCount > 9 ? '9+' : pendingCount}
        </span>
      )}
    </button>
  )
}

