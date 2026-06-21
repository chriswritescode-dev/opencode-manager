import { useMutation } from '@tanstack/react-query'
import { getDevServerStatus, getDevPreviewUrl } from '@/api/devServer'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import { Loader2, Play } from 'lucide-react'
import type { OpenHtmlArtifactInput } from '@/lib/htmlArtifacts'

interface DevServerPreviewButtonProps {
  repoId: number
  onOpen: (input: OpenHtmlArtifactInput) => void
}

export function DevServerPreviewButton({ repoId, onOpen }: DevServerPreviewButtonProps) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => getDevServerStatus(repoId),
    onSuccess: (state) => {
      if (state.status !== 'running') {
        showToast.error(`No app detected on localhost:${state.port}`)
        return
      }

      onOpen({
        source: 'devserver',
        previewUrl: getDevPreviewUrl(repoId),
        title: 'App preview',
      })
    },
    onError: () => {
      showToast.error('Failed to check preview port')
    },
  })

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => mutate()}
      disabled={isPending}
      aria-label="Open app preview"
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
    </Button>
  )
}
