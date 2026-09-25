import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { getConfigPath } from '@opencode-manager/shared/config/env'
import {
  getOpenCodeServiceRegistrationPath,
  getOpenCodeServiceSettingsPath,
  prepareOpenCodeServiceLaunch,
  writeOpenCodeServiceSettings,
} from '../../src/services/opencode-service-mode'

describe('opencode service mode paths', () => {
  const settingsPath = getOpenCodeServiceSettingsPath()

  afterEach(async () => {
    await fs.rm(settingsPath, { force: true })
  })

  it('derives the settings path from the Manager config directory', () => {
    expect(getOpenCodeServiceSettingsPath()).toBe(path.join(getConfigPath(), 'service.json'))
  })

  it('derives the registration path from the state home', () => {
    expect(getOpenCodeServiceRegistrationPath({ XDG_CONFIG_HOME: '/config', XDG_STATE_HOME: '/state' })).toBe(
      '/state/opencode/service.json',
    )
  })

  it('writes the service settings with owner-only permissions', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-service-mode-'))
    try {
      await writeOpenCodeServiceSettings(directory, 'secret-password')

      expect(JSON.parse(await fs.readFile(path.join(directory, 'service.json'), 'utf8'))).toEqual({ password: 'secret-password' })
      expect((await fs.stat(path.join(directory, 'service.json'))).mode & 0o777).toBe(0o600)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('ignores OPENCODE_CONFIG_DIR and writes into the derived path', async () => {
    const attackerDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-service-mode-attacker-'))
    const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-service-mode-state-'))
    try {
      const env = { XDG_CONFIG_HOME: attackerDirectory, XDG_STATE_HOME: stateDirectory, OPENCODE_CONFIG_DIR: attackerDirectory }
      await prepareOpenCodeServiceLaunch(env, 'secret-password')

      expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ password: 'secret-password' })
      await expect(fs.access(path.join(attackerDirectory, 'service.json'))).rejects.toThrow()
      await expect(fs.access(path.join(stateDirectory, 'opencode', 'service.json'))).rejects.toThrow()
    } finally {
      await fs.rm(attackerDirectory, { recursive: true, force: true })
      await fs.rm(stateDirectory, { recursive: true, force: true })
    }
  })
})
