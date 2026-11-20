import { X } from 'lucide-react'
import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'
import { useUsageDialog } from '@/hooks/useUsageDialog'
import { UsageDashboard } from './UsageDashboard'

export function UsageDialog() {
  const { isOpen, close } = useUsageDialog()
  const [serverId] = useSidebarServerSelection()

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent fullscreen>
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <DialogTitle className="text-base font-semibold">Usage</DialogTitle>
            <div className="flex items-center gap-2">
              <LinkedServersNav variant="header" />
              <Button variant="ghost" size="icon" aria-label="Close" onClick={close}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {isOpen && <UsageDashboard serverId={serverId} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
