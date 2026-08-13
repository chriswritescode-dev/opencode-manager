import type { Database } from 'bun:sqlite'
import { logger } from '../../utils/logger'
import { SandboxRuntimeService } from './runtime'
import { opencodeServerManager } from '../opencode-single-server'

export function isSandboxEnforcementActive(db: Database): boolean {
  let preferenceEnabled = false
  try {
    preferenceEnabled = new SandboxRuntimeService(db).isEnabled()
  } catch (error) {
    logger.warn('Failed to read the sandbox preference; treating sandbox enforcement as active:', error)
    return true
  }
  return preferenceEnabled || opencodeServerManager.isSandboxEnforced()
}
