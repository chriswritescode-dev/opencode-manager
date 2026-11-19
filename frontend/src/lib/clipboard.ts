async function copyViaExecCommand(text: string): Promise<boolean> {
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    document.body.appendChild(textArea)
    textArea.select()
    try {
      return document.execCommand('copy')
    } finally {
      document.body.removeChild(textArea)
    }
  } catch {
    return false
  }
}

async function attemptCopy(attempt: () => Promise<void>): Promise<boolean> {
  try {
    await attempt()
    return true
  } catch {
    return false
  }
}

export async function copyTextToClipboard(content: string | Promise<string>): Promise<boolean> {
  if ('ClipboardItem' in globalThis && navigator.clipboard?.write) {
    const copied = await attemptCopy(() => {
      const item = new ClipboardItem({
        'text/plain': Promise.resolve(content).then(
          (text) => new Blob([text], { type: 'text/plain' }),
        ),
      })
      return navigator.clipboard.write([item])
    })
    if (copied) return true
  }

  const text = await Promise.resolve(content).catch(() => null)
  if (text === null) return false

  if (await attemptCopy(() => navigator.clipboard.writeText(text))) return true

  return copyViaExecCommand(text)
}
