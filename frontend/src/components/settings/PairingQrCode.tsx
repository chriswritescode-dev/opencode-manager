import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type RenderSvg = (typeof import('uqr'))['renderSVG']

interface PairingQrCodeProps {
  value: string
  label: string
  blurred?: boolean
}

export function PairingQrCode({ value, label, blurred = false }: PairingQrCodeProps) {
  const [renderSvg, setRenderSvg] = useState<RenderSvg | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let active = true
    const loadRenderer = async () => {
      try {
        const module = await import('uqr')
        if (active) setRenderSvg(() => module.renderSVG)
      } catch {
        if (active) setLoadFailed(true)
      }
    }
    void loadRenderer()
    return () => {
      active = false
    }
  }, [])

  const source = useMemo(() => {
    if (!renderSvg) return null
    try {
      return `data:image/svg+xml;utf8,${encodeURIComponent(renderSvg(value, { ecc: 'M', border: 2 }))}`
    } catch {
      return null
    }
  }, [renderSvg, value])

  if (loadFailed) {
    return (
      <p className="text-sm text-destructive">
        The QR code could not be loaded. Reload the page and try again.
      </p>
    )
  }

  if (!renderSvg) return null

  if (!source) {
    return (
      <p className="text-sm text-destructive">
        This QR code holds too much data. Remove some remote access headers.
      </p>
    )
  }

  return (
    <img
      alt={label}
      src={source}
      className={cn('w-full max-w-64 rounded bg-white', blurred && 'blur-md')}
    />
  )
}
