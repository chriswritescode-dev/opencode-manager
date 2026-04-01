import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  promptService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../src/services/prompt-templates', () => ({
  PromptTemplateService: vi.fn().mockImplementation(() => mocks.promptService),
  PromptTemplateServiceError: class PromptTemplateServiceError extends Error {
    constructor(message: string, public statusCode: number = 500) {
      super(message)
      this.name = 'PromptTemplateServiceError'
    }
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createPromptTemplateRoutes } from '../../src/routes/prompt-templates'
import { PromptTemplateServiceError } from '../../src/services/prompt-templates'

describe('prompt template routes', () => {
  let app: ReturnType<typeof createPromptTemplateRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.promptService.list.mockReset()
    mocks.promptService.getById.mockReset()
    mocks.promptService.create.mockReset()
    mocks.promptService.update.mockReset()
    mocks.promptService.delete.mockReset()

    app = createPromptTemplateRoutes({} as never)
  })

  it('lists all templates including seeded ones from migration', async () => {
    const mockTemplates = [
      { id: 1, title: 'Repo Health Report', category: 'Health', cadence_hint: 'Daily', suggested_name: 'repo-health', suggested_description: 'Report', description: 'Report', prompt: 'Check health' },
      { id: 2, title: 'Dependency Watchlist', category: 'Dependencies', cadence_hint: 'Weekly', suggested_name: 'dep-watch', suggested_description: 'Watch deps', description: 'Watch', prompt: 'Watch deps' },
    ]
    mocks.promptService.list.mockReturnValue(mockTemplates)

    const response = await app.request('/')
    expect(response.status).toBe(200)

    const body = await response.json() as { templates: Array<{ id: number; title: string }> }
    expect(body.templates.length).toBe(2)
    expect(body.templates[0]?.title).toBe('Repo Health Report')
    expect(body.templates[1]?.title).toBe('Dependency Watchlist')
  })

  it('creates a template and returns 201', async () => {
    const newTemplate = {
      title: 'Test Template',
      category: 'Test',
      cadenceHint: 'Daily',
      suggestedName: 'Test job name',
      suggestedDescription: 'Test description',
      description: 'Test description',
      prompt: 'Test prompt content',
    }

    const createdTemplate = { id: 1, ...newTemplate }
    mocks.promptService.create.mockReturnValue(createdTemplate)

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTemplate),
    })

    expect(response.status).toBe(201)
    const body = await response.json() as { template: { id: number; title: string } }
    expect(body.template.title).toBe('Test Template')
    expect(body.template.id).toBe(1)
  })

  it('gets a template by id', async () => {
    const mockTemplate = { id: 1, title: 'Get Test', category: 'Test', cadence_hint: 'Daily', suggested_name: 'get-test', suggested_description: '', description: '', prompt: 'Test prompt' }
    mocks.promptService.getById.mockReturnValue(mockTemplate)

    const getResponse = await app.request('/1')
    expect(getResponse.status).toBe(200)

    const body = await getResponse.json() as { template: { id: number; title: string } }
    expect(body.template.id).toBe(1)
    expect(body.template.title).toBe('Get Test')
  })

  it('returns 404 for missing template', async () => {
    mocks.promptService.getById.mockImplementation(() => {
      throw new PromptTemplateServiceError('Template not found', 404)
    })

    const response = await app.request('/99999')
    expect(response.status).toBe(404)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Template not found')
  })

  it('updates a template', async () => {
    const updatedTemplate = { id: 1, title: 'Updated Title', category: 'Test', cadence_hint: 'Daily', suggested_name: 'updated', suggested_description: '', description: '', prompt: 'Test prompt' }
    mocks.promptService.update.mockReturnValue(updatedTemplate)

    const updateResponse = await app.request('/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    })

    expect(updateResponse.status).toBe(200)
    const body = await updateResponse.json() as { template: { title: string } }
    expect(body.template.title).toBe('Updated Title')
  })

  it('returns 404 when updating missing template', async () => {
    mocks.promptService.update.mockImplementation(() => {
      throw new PromptTemplateServiceError('Template not found', 404)
    })

    const response = await app.request('/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    })

    expect(response.status).toBe(404)
  })

  it('deletes a template and returns 204', async () => {
    mocks.promptService.delete.mockReturnValue(undefined)

    const deleteResponse = await app.request('/1', {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(204)
  })

  it('returns 404 when deleting missing template', async () => {
    mocks.promptService.delete.mockImplementation(() => {
      throw new PromptTemplateServiceError('Template not found', 404)
    })

    const response = await app.request('/99999', {
      method: 'DELETE',
    })

    expect(response.status).toBe(404)
  })
})
