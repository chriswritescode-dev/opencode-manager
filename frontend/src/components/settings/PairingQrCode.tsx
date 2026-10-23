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

  useEffect(() => {
    let active = true
    void import('uqr').then((module) => {
      if (active) setRenderSvg(() => module.renderSVG)
    })
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
