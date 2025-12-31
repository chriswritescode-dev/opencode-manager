import { promises as fs } from 'fs'
import path from 'path'
import { getAuthPath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { AuthCredentialsSchema } from '../../../shared/src/schemas/auth'
import type { z } from 'zod'

type AuthCredentials = z.infer<typeof AuthCredentialsSchema>

export class AuthService {
  private authPath = getAuthPath()

  private migrateEntry(entry: Record<string, unknown>): Record<string, unknown> {
    if (entry.type === 'apiKey' && typeof entry.apiKey === 'string') {
      return {
        type: 'api',
        key: entry.apiKey,
      }
    }
    return entry
  }

  async getAll(): Promise<AuthCredentials> {
    try {
      const data = await fs.readFile(this.authPath, 'utf-8')
      const parsed = JSON.parse(data) as Record<string, Record<string, unknown>>
      
      let needsMigration = false
      const migrated: Record<string, Record<string, unknown>> = {}
      
      for (const [key, entry] of Object.entries(parsed)) {
        const migratedEntry = this.migrateEntry(entry)
        if (migratedEntry !== entry) {
          needsMigration = true
        }
        migrated[key] = migratedEntry
      }
      
      if (needsMigration) {
        await fs.writeFile(this.authPath, JSON.stringify(migrated, null, 2), { mode: 0o600 })
        logger.info('Migrated auth.json to new schema format')
      }
      
      return AuthCredentialsSchema.parse(migrated)
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
      type: 'api',
      key: apiKey,
    }

    await fs.mkdir(path.dirname(this.authPath), { recursive: true })
    await fs.writeFile(this.authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
    
    logger.info(`Set credentials for provider: ${providerId}`)
  }

  async delete(providerId: string): Promise<void> {
    const auth = await this.getAll()
    delete auth[providerId]
    
    await fs.writeFile(this.authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
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

}
