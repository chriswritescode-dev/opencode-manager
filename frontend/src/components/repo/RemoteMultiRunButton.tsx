import { useState } from 'react'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiRunSheet } from '@/components/repo/MultiRunSheet'

interface RemoteMultiRunProps {
  serverId: string
  directory: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The multi-run sheet for one project on a linked OpenCode server, controlled by its caller.
 */
export function RemoteMultiRun({ serverId, directory, open, onOpenChange }: RemoteMultiRunProps) {
  return (
    <MultiRunSheet
      target={{ kind: 'server', serverId, directory }}
      directory={directory}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

export function RemoteMultiRunButton({ serverId, directory }: { serverId: string; directory: string }) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  const handleOpen = () => {
    setMounted(true)
    setOpen(true)
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleOpen}
        aria-label="Multi-run"
        className="h-9 w-9 shrink-0 p-0 @min-[36rem]:w-auto @min-[36rem]:px-3"
      >
        <Layers className="h-4 w-4 @min-[36rem]:mr-2" />
        <span className="hidden @min-[36rem]:inline">Multi-run</span>
      </Button>
      {mounted ? (
        <RemoteMultiRun
          serverId={serverId}
          directory={directory}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}
