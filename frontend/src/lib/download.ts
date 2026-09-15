import { fetchWrapperBlob } from '@/api/fetchWrapper'
import { showToast } from './toast'

function isIosHomeScreenApp(): boolean {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIos) return false

  const isStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return isStandalone
}

function saveViaAnchor(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function saveViaShareSheet(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })

  if (!navigator.canShare?.({ files: [file] })) {
    showToast.error(`${filename} cannot be saved from this device`)
    return
  }

  try {
    await navigator.share({ files: [file] })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'AbortError') return
    if (name === 'NotAllowedError') {
      showToast.info(`Tap Save to finish saving ${filename}`, {
        action: { label: 'Save', onClick: () => void saveViaShareSheet(blob, filename) },
      })
      return
    }
    showToast.error(`Failed to save ${filename}`)
  }
}

export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (isIosHomeScreenApp()) {
    await saveViaShareSheet(blob, filename)
    return
  }

  const url = URL.createObjectURL(blob)
  saveViaAnchor(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function saveFileFromUrl(url: string, filename: string): Promise<void> {
  if (isIosHomeScreenApp()) {
    await saveFile(await fetchWrapperBlob(url), filename)
    return
  }

  saveViaAnchor(url, filename)
}
