import { useState } from 'react'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiRunSheet } from '@/components/repo/MultiRunSheet'

interface RemoteMultiRunButtonProps {
  serverId: string
  directory: string
}

export function RemoteMultiRunButton({ serverId, directory }: RemoteMultiRunButtonProps) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  const handleOpen = () => {
    setMounted(true)
    setOpen(true)
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleOpen} className="shrink-0">
        <Layers className="mr-1 h-4 w-4" />
        Multi-run
      </Button>
      {mounted ? (
        <MultiRunSheet
          target={{ kind: 'server', serverId, directory }}
          directory={directory}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}
