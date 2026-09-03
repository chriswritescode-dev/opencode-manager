import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import {
  fetchFileInfo,
  uploadFileEntry,
  writeFileEntry,
  deleteFileEntry,
  renameFileEntry,
} from './files'

describe('files api', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchFileInfo requests the file path and sends credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: 'a.txt', path: 'a.txt', isDirectory: false }), { status: 200 }),
    )

    await fetchFileInfo('dir/a.txt')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/files')
    expect(url).toContain('path=dir%2Fa.txt')
    expect(init.credentials).toBe('include')
    expect(init.method).toBeUndefined()
  })

  it('uploadFileEntry posts FormData without forcing a Content-Type', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const formData = new FormData()
    formData.append('file', new File(['x'], 'x.txt'))

    await uploadFileEntry('dir', formData)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.body).toBeInstanceOf(FormData)
    const contentType = (init.headers as Record<string, string> | undefined)?.['Content-Type']
    expect(contentType).toBeUndefined()
  })

  it('writeFileEntry puts JSON type and content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await writeFileEntry('dir/a.txt', 'file', '')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('path=dir%2Fa.txt')
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ type: 'file', content: '' })
  })

  it('deleteFileEntry issues DELETE with no timeout cap', async () => {
    vi.useFakeTimers()
    let resolveFetch: (value: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const pending = deleteFileEntry('dir/a.txt')
    await vi.advanceTimersByTimeAsync(60_000)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
    expect(init.signal.aborted).toBe(false)

    resolveFetch(new Response(null, { status: 204 }))
    vi.useRealTimers()
    await pending
  })

  it('renameFileEntry patches the new path', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await renameFileEntry('dir/old.txt', 'dir/new.txt')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('path=dir%2Fold.txt')
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ newPath: 'dir/new.txt' })
  })

  it('uploadFileEntry surfaces the server error message as FetchError', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'File too large' }), { status: 413 })),
    )

    await expect(uploadFileEntry('dir', new FormData())).rejects.toThrow(FetchError)
    await expect(uploadFileEntry('dir', new FormData())).rejects.toMatchObject({
      statusCode: 413,
      message: 'File too large',
    })
  })
})
