import { promises as fs } from 'fs'
import path from 'path'
import { getAuthPath } from '../config'
import { logger } from '../utils/logger'
import { AuthCredentialsSchema } from '../../../shared/src/schemas/auth'
import type { z } from 'zod'

type AuthCredentials = z.infer<typeof AuthCredentialsSchema>
type AuthEntry = AuthCredentials[string]

export class AuthService {
  private authPath = getAuthPath()

  async getAll(): Promise<AuthCredentials> {
    try {
      const data = await fs.readFile(this.authPath, 'utf-8')
      const parsed = JSON.parse(data)
      return AuthCredentialsSchema.parse(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      logger.error('Failed to read auth.json:', error)
      return {}
    }
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    const auth = await this.getAll()
    auth[providerId] = {
      type: 'apiKey',
      apiKey,
    }

    await fs.mkdir(path.dirname(this.authPath), { recursive: true })
    await fs.writeFile(this.authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
    
    logger.info(`Set credentials for provider: ${providerId}`)
  }

  async delete(providerId: string): Promise<void> {
    const auth = await this.getAll()
    delete auth[providerId]
    
    await fs.writeFile(this.authPath, JSON.stringify(auth, null, 2))
    logger.info(`Deleted credentials for provider: ${providerId}`)
  }

  async list(): Promise<string[]> {
    const auth = await this.getAll()
    return Object.keys(auth)
  }

  async has(providerId: string): Promise<boolean> {
    const auth = await this.getAll()
    return !!auth[providerId]
  }

  async get(providerId: string): Promise<AuthEntry | null> {
    const auth = await this.getAll()
    return auth[providerId] || null
  }
}
