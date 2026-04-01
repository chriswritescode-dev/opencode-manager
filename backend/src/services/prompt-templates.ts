import type { Database } from 'bun:sqlite'
import type { CreatePromptTemplateRequest, UpdatePromptTemplateRequest } from '@opencode-manager/shared/schemas'
import {
  listPromptTemplates,
  getPromptTemplateById,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
} from '../db/prompt-templates'

export class PromptTemplateServiceError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message)
    this.name = 'PromptTemplateServiceError'
  }
}

export class PromptTemplateService {
  constructor(private db: Database) {}

  list() {
    return listPromptTemplates(this.db)
  }

  getById(id: number) {
    const template = getPromptTemplateById(this.db, id)
    if (!template) throw new PromptTemplateServiceError('Template not found', 404)
    return template
  }

  create(data: CreatePromptTemplateRequest) {
    return createPromptTemplate(this.db, data)
  }

  update(id: number, data: UpdatePromptTemplateRequest) {
    const template = updatePromptTemplate(this.db, id, data)
    if (!template) throw new PromptTemplateServiceError('Template not found', 404)
    return template
  }

  delete(id: number) {
    const deleted = deletePromptTemplate(this.db, id)
    if (!deleted) throw new PromptTemplateServiceError('Template not found', 404)
  }
}
