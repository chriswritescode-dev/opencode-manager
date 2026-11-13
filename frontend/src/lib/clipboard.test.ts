import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { copyTextToClipboard } from './clipboard'

const originalClipboard = navigator.clipboard
const originalExecCommand = document.execCommand

interface ClipboardStub {
  writeText: Mock<(text: string) => Promise<void>>
  readText: Mock<() => Promise<string>>
  read: Mock<() => Promise<ClipboardItem[]>>
  write?: Mock<(items: ClipboardItem[]) => Promise<void>>
}

function stubClipboard(options: { withWrite?: boolean; writeText?: ClipboardStub['writeText'] } = {}): ClipboardStub {
  const clipboard: ClipboardStub = {
    writeText: options.writeText ?? vi.fn<(text: string) => Promise<void>>(async () => undefined),
    readText: vi.fn<() => Promise<string>>(async () => ''),
    read: vi.fn<() => Promise<ClipboardItem[]>>(async () => []),
  }
  if (options.withWrite) {
    clipboard.write = vi.fn<(items: ClipboardItem[]) => Promise<void>>(async () => undefined)
  }
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    writable: true,
    configurable: true,
  })
  return clipboard
}

function stubExecCommand(result: boolean) {
  const execCommand = vi.fn(() => result)
  document.execCommand = execCommand
  return execCommand
}

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    })
    document.execCommand = originalExecCommand
  })

  it('writes the awaited text through writeText when ClipboardItem is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    const clipboard = stubClipboard({ withWrite: true })

    await expect(copyTextToClipboard(Promise.resolve('hello'))).resolves.toBe(true)
    expect(clipboard.writeText).toHaveBeenCalledWith('hello')
  })

  it('writes a ClipboardItem through clipboard.write when available', async () => {
    const clipboard = stubClipboard({ withWrite: true })
    vi.stubGlobal('ClipboardItem', class {
      data: Record<string, ClipboardItemData>

      constructor(data: Record<string, ClipboardItemData>) {
        this.data = data
      }
    })

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(clipboard.write).toHaveBeenCalledTimes(1)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('resolves false when the content promise rejects', async () => {
    stubClipboard()

    await expect(copyTextToClipboard(Promise.reject(new Error('nope')))).resolves.toBe(false)
  })

  it('falls back to execCommand when writeText rejects', async () => {
    stubClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) })
    const execCommand = stubExecCommand(true)

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
