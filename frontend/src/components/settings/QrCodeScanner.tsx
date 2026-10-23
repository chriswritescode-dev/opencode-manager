import { useEffect, useRef, useState } from 'react'
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

const MAX_SCAN_DIMENSION = 640
const DECODE_INTERVAL_MS = 100

type QrDecoder = typeof import('jsqr')['default']

interface QrCodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onResult: (text: string) => void
  title?: string
  description?: string
  fallbackHint?: string
}

function describeCameraError(error: unknown, fallbackHint: string): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return `Camera permission was denied. Allow camera access for this site. ${fallbackHint}`
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return `No camera was found on this device. ${fallbackHint}`
    }
    if (error.name === 'NotReadableError') {
      return `The camera is already in use by another application. ${fallbackHint}`
    }
  }
  return `The camera could not be started. ${fallbackHint}`
}

function fitScanDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_SCAN_DIMENSION) {
    return { width, height }
  }
  const scale = MAX_SCAN_DIMENSION / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export function QrCodeScanner({
  open,
  onOpenChange,
  onResult,
  title = 'Scan pairing QR code',
  description = 'Point the camera at the QR code shown by the OpenCode server you want to link.',
  fallbackHint = 'Paste the pairing link instead.',
}: QrCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const decoderRef = useRef<QrDecoder | null>(null)
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
    let lastDecodeAt = Number.NEGATIVE_INFINITY
    let canvasWidth = 0
    let canvasHeight = 0
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

    const scanFrame = (timestamp: number) => {
      if (cancelled || decoded) return
      if (timestamp - lastDecodeAt < DECODE_INTERVAL_MS) {
        frameId = requestAnimationFrame(scanFrame)
        return
      }
      const video = videoRef.current
      const decoder = decoderRef.current
      if (!video || !context || !decoder || video.readyState < video.HAVE_ENOUGH_DATA) {
        frameId = requestAnimationFrame(scanFrame)
        return
      }
      const size = fitScanDimensions(video.videoWidth, video.videoHeight)
      if (size.width < 1 || size.height < 1) {
        frameId = requestAnimationFrame(scanFrame)
        return
      }
      lastDecodeAt = timestamp
      if (size.width !== canvasWidth || size.height !== canvasHeight) {
        canvas.width = size.width
        canvas.height = size.height
        canvasWidth = size.width
        canvasHeight = size.height
      }
      context.drawImage(video, 0, 0, size.width, size.height)
      const imageData = context.getImageData(0, 0, size.width, size.height)
      const code = decoder(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (code?.data) {
        decoded = true
        stopCamera()
        onResultRef.current(code.data)
        onOpenChange(false)
        return
      }
      frameId = requestAnimationFrame(scanFrame)
    }

    const loadDecoder = async (): Promise<QrDecoder> => {
      if (!decoderRef.current) {
        const module = await import('jsqr')
        decoderRef.current = module.default
      }
      return decoderRef.current
    }

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(`Camera access is not available in this browser. ${fallbackHint}`)
        setIsStarting(false)
        return
      }
      if (!window.isSecureContext) {
        setError(`Camera access requires a secure (HTTPS) connection. ${fallbackHint}`)
        setIsStarting(false)
        return
      }
      try {
        await loadDecoder()
      } catch {
        if (cancelled) return
        setError(`The QR decoder could not be loaded. ${fallbackHint}`)
        setIsStarting(false)
        return
      }
      if (cancelled) return
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
        setError(describeCameraError(cameraError, fallbackHint))
        setIsStarting(false)
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [open, onOpenChange, fallbackHint])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
