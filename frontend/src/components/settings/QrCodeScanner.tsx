import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface QrCodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onResult: (text: string) => void
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera permission was denied. Allow camera access for this site or paste the pairing link instead.'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'No camera was found on this device. Paste the pairing link instead.'
    }
    if (error.name === 'NotReadableError') {
      return 'The camera is already in use by another application. Paste the pairing link instead.'
    }
  }
  return 'The camera could not be started. Paste the pairing link instead.'
}

export function QrCodeScanner({ open, onOpenChange, onResult }: QrCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setIsStarting(true)

    let stream: MediaStream | null = null
    let frameId: number | null = null
    let cancelled = false
    let decoded = false
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    const stopCamera = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
    }

    const scanFrame = () => {
      if (cancelled || decoded) return
      const video = videoRef.current
      if (!video || !context || video.readyState < video.HAVE_ENOUGH_DATA) {
        frameId = requestAnimationFrame(scanFrame)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code?.data) {
        decoded = true
        stopCamera()
        onResultRef.current(code.data)
        onOpenChange(false)
        return
      }
      frameId = requestAnimationFrame(scanFrame)
    }

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is not available in this browser. Paste the pairing link instead.')
        setIsStarting(false)
        return
      }
      if (!window.isSecureContext) {
        setError('Camera access requires a secure (HTTPS) connection. Paste the pairing link instead.')
        setIsStarting(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        setIsStarting(false)
        frameId = requestAnimationFrame(scanFrame)
      } catch (cameraError) {
        if (cancelled) return
        setError(describeCameraError(cameraError))
        setIsStarting(false)
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan pairing QR code</DialogTitle>
          <DialogDescription>
            Point the camera at the QR code shown by the OpenCode server you want to link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              aria-label="QR code scanner preview"
              muted
              playsInline
            />
            {isStarting && !error && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting camera...
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
