import { ServiceError } from '../utils/service-error'

export class ChangeWalkthroughError extends ServiceError {
  constructor(message: string, status: number, options?: { code?: string; details?: unknown }) {
    super(message, status, options)
    this.name = 'ChangeWalkthroughError'
  }
}
