import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReplaceRemoteAccessHeadersRequest } from '@opencode-manager/shared/schemas'
import { RemoteAccessHeadersSettings } from './RemoteAccessHeadersSettings'

const mocks = vi.hoisted(() => ({
  getRemoteAccessHeaders: vi.fn(),
  replaceRemoteAccessHeaders: vi.fn(),
  clearRemoteAccessHeaders: vi.fn(),
}))

vi.mock('@/api/devicePairing', () => ({
  getRemoteAccessHeaders: mocks.getRemoteAccessHeaders,
  replaceRemoteAccessHeaders: mocks.replaceRemoteAccessHeaders,
  clearRemoteAccessHeaders: mocks.clearRemoteAccessHeaders,
}))

const STORED_VALUE_PLACEHOLDER = 'Stored – leave blank to keep'

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RemoteAccessHeadersSettings />
    </QueryClientProvider>,
  )
}

describe('RemoteAccessHeadersSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRemoteAccessHeaders.mockResolvedValue({ headers: [], unreadable: false })
    mocks.replaceRemoteAccessHeaders.mockImplementation(
      async (body: ReplaceRemoteAccessHeadersRequest) => ({
        headers: body.headers.map((header) => ({ name: header.name, hasValue: true })),
        unreadable: false,
      }),
    )
    mocks.clearRemoteAccessHeaders.mockResolvedValue({ headers: [], unreadable: false })
  })

  it('adds the Cloudflare service token rows and saves typed values only once', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(
      await screen.findByRole('button', { name: /Cloudflare Access service token/i }),
    )

    const nameInputs = screen.getAllByPlaceholderText('Header name')
    expect(nameInputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'CF-Access-Client-Id',
      'CF-Access-Client-Secret',
    ])

    const valueInputs = screen.getAllByPlaceholderText('Value')
    await user.type(valueInputs[0] as HTMLInputElement, 'id')
    await user.type(valueInputs[1] as HTMLInputElement, 'secret')

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(mocks.replaceRemoteAccessHeaders).toHaveBeenCalledWith({
        headers: [
          { name: 'CF-Access-Client-Id', value: 'id' },
          { name: 'CF-Access-Client-Secret', value: 'secret' },
        ],
      })
    })

    await waitFor(() => {
      expect(screen.queryByDisplayValue('secret')).not.toBeInTheDocument()
    })
    expect(await screen.findAllByPlaceholderText(STORED_VALUE_PLACEHOLDER)).toHaveLength(2)
  })

  it('keeps a stored value when its blank field is left untouched', async () => {
    mocks.getRemoteAccessHeaders.mockResolvedValue({
      headers: [{ name: 'CF-Access-Client-Secret', hasValue: true }],
      unreadable: false,
    })
    const user = userEvent.setup()
    renderSettings()

    const valueInput = await screen.findByPlaceholderText(STORED_VALUE_PLACEHOLDER)
    expect(valueInput).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(mocks.replaceRemoteAccessHeaders).toHaveBeenCalledWith({
        headers: [{ name: 'CF-Access-Client-Secret', value: undefined }],
      })
    })
  })

  it('shows the schema error for a reserved header name and blocks saving', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: /Add header/i }))
    await user.type(screen.getByPlaceholderText('Header name'), 'Cookie')
    await user.type(screen.getByPlaceholderText('Value'), 'session')

    expect(await screen.findByText('This header name is reserved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(mocks.replaceRemoteAccessHeaders).not.toHaveBeenCalled()
  })

  it('requires a value after renaming a stored row to a name the server does not have', async () => {
    mocks.getRemoteAccessHeaders.mockResolvedValue({
      headers: [{ name: 'CF-Access-Client-Secret', hasValue: true }],
      unreadable: false,
    })
    const user = userEvent.setup()
    renderSettings()

    expect(await screen.findByPlaceholderText(STORED_VALUE_PLACEHOLDER)).toBeInTheDocument()

    const nameInput = screen.getByPlaceholderText('Header name')
    await user.clear(nameInput)
    await user.type(nameInput, 'X-Custom-Secret')

    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled()

    await user.type(screen.getByPlaceholderText('Value'), 'new-secret')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(mocks.replaceRemoteAccessHeaders).toHaveBeenCalledWith({
        headers: [{ name: 'X-Custom-Secret', value: 'new-secret' }],
      })
    })
  })

  it('shows the decrypt alert when the stored headers are unreadable', async () => {
    mocks.getRemoteAccessHeaders.mockResolvedValue({ headers: [], unreadable: true })
    renderSettings()

    expect(
      await screen.findByText(
        'Stored headers could not be decrypted (AUTH_SECRET may have changed). Enter them again.',
      ),
    ).toBeInTheDocument()
  })

  it('clears all headers after confirmation', async () => {
    mocks.getRemoteAccessHeaders.mockResolvedValue({
      headers: [{ name: 'CF-Access-Client-Secret', hasValue: true }],
      unreadable: false,
    })
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('button', { name: /Clear all/i }))
    await user.click(await screen.findByRole('button', { name: /^Delete$/i }))

    await waitFor(() => {
      expect(mocks.clearRemoteAccessHeaders).toHaveBeenCalledTimes(1)
    })
  })
})
