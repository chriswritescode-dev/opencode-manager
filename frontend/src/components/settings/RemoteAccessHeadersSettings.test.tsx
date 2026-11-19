import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { RemoteAccessHeadersSettings } from './RemoteAccessHeadersSettings'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const STORED_VALUE_PLACEHOLDER = 'Stored – leave blank to keep'

const replaceRequestSchema = z.object({
  headers: z.array(z.object({ name: z.string(), value: z.string().optional() })),
})

interface StoredHeader {
  name: string
  hasValue: boolean
}

function createHeadersServer(initial: StoredHeader[] = [], unreadable = false) {
  let headers = initial

  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/settings/remote-access-headers',
      respond: () => ({ json: { headers, unreadable } }),
    },
    {
      method: 'PUT',
      path: '/api/settings/remote-access-headers',
      respond: (request) => {
        const parsed = replaceRequestSchema.parse(request.body)
        headers = parsed.headers.map((header) => ({
          name: header.name,
          hasValue: header.value !== undefined,
        }))
        return { json: { headers, unreadable: false } }
      },
    },
    {
      method: 'DELETE',
      path: '/api/settings/remote-access-headers',
      respond: () => {
        headers = []
        return { json: { headers, unreadable: false } }
      },
    },
  ]

  return { routes, headers: () => headers }
}

function renderSettings(initial: StoredHeader[] = [], unreadable = false) {
  const server = createHeadersServer(initial, unreadable)
  const result = renderWithProviders(<RemoteAccessHeadersSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: server.routes,
  })
  return { ...result, server }
}

describe('RemoteAccessHeadersSettings', () => {
  it('adds the Cloudflare service token rows and saves typed values only once', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings()

    await user.click(
      await screen.findByRole('button', { name: /Cloudflare Access service token/i }),
    )

    expect(await screen.findByLabelText('Header 1 name')).toHaveValue('CF-Access-Client-Id')
    expect(screen.getByLabelText('Header 2 name')).toHaveValue('CF-Access-Client-Secret')

    await user.type(screen.getByLabelText('Header 1 value'), 'id')
    await user.type(screen.getByLabelText('Header 2 value'), 'secret')

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findAllByPlaceholderText(STORED_VALUE_PLACEHOLDER)).toHaveLength(2)
    expect(fetchFake.lastRequest('PUT', '/api/settings/remote-access-headers')?.body).toEqual({
      headers: [
        { name: 'CF-Access-Client-Id', value: 'id' },
        { name: 'CF-Access-Client-Secret', value: 'secret' },
      ],
    })
    expect(screen.queryByDisplayValue('secret')).not.toBeInTheDocument()
  })

  it('keeps a stored value when its blank field is left untouched', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings([{ name: 'CF-Access-Client-Secret', hasValue: true }])

    const valueInput = await screen.findByLabelText('Header 1 value')
    expect(valueInput).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findByLabelText('Header 1 name')).toHaveValue('CF-Access-Client-Secret')
    expect(fetchFake.lastRequest('PUT', '/api/settings/remote-access-headers')?.body).toEqual({
      headers: [{ name: 'CF-Access-Client-Secret' }],
    })
  })

  it('shows the schema error for a reserved header name and blocks saving', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings()

    await user.click(await screen.findByRole('button', { name: /Add header/i }))
    await user.type(screen.getByLabelText('Header 1 name'), 'Cookie')
    await user.type(screen.getByLabelText('Header 1 value'), 'session')

    expect(await screen.findByText('This header name is reserved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(fetchFake.findRequests('PUT', '/api/settings/remote-access-headers')).toHaveLength(0)
  })

  it('requires a value after renaming a stored row to a name the server does not have', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings([{ name: 'CF-Access-Client-Secret', hasValue: true }])

    const nameInput = await screen.findByLabelText('Header 1 name')
    await user.clear(nameInput)
    await user.type(nameInput, 'X-Custom-Secret')

    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled()

    await user.type(screen.getByLabelText('Header 1 value'), 'new-secret')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findByLabelText('Header 1 name')).toHaveValue('X-Custom-Secret')
    expect(fetchFake.lastRequest('PUT', '/api/settings/remote-access-headers')?.body).toEqual({
      headers: [{ name: 'X-Custom-Secret', value: 'new-secret' }],
    })
  })

  it('shows the decrypt alert when the stored headers are unreadable', async () => {
    renderSettings([], true)

    expect(
      await screen.findByText(
        'Stored headers could not be decrypted (AUTH_SECRET may have changed). Enter them again.',
      ),
    ).toBeInTheDocument()
  })

  it('clears all headers after confirmation', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSettings([{ name: 'CF-Access-Client-Secret', hasValue: true }])

    await user.click(await screen.findByRole('button', { name: /Clear all/i }))
    await user.click(await screen.findByRole('button', { name: /^Delete$/i }))

    expect(await screen.findByText('No remote access headers are stored.')).toBeInTheDocument()
    expect(fetchFake.findRequests('DELETE', '/api/settings/remote-access-headers')).toHaveLength(1)
  })
})
