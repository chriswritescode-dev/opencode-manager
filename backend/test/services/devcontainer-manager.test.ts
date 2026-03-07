import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { initializeDatabase } from '../../src/db/schema'
import { DevcontainerManager } from '../../src/services/devcontainer-manager'
import type { DevcontainerConfig } from '@opencode-manager/shared'
import * as db from '../../src/db/queries'

vi.mock('../../src/utils/process', () => ({
  execCommand: vi.fn().mockResolvedValue(''),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockImplementation((path: string) => {
    if (path.includes('minimal.json')) {
      return Promise.resolve(JSON.stringify({
        name: 'Minimal',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git curl' }
        }
      }))
    }
    if (path.includes('Dockerfile.nix')) {
      return Promise.resolve('FROM nixos/nix:2.18.1')
    }
    return Promise.reject(new Error('File not found'))
  }),
}))

describe('DevcontainerManager', () => {
  let database: Database
  let devcontainerManager: DevcontainerManager

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    devcontainerManager = new DevcontainerManager(database)
    vi.clearAllMocks()
  })

  describe('calculateConfigHash', () => {
    it('should generate consistent hash for same config', () => {
      const config: DevcontainerConfig = {
        name: 'test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git nodejs_22',
          },
        },
      }

      const hash1 = devcontainerManager.calculateConfigHash(config)
      const hash2 = devcontainerManager.calculateConfigHash(config)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(16)
    })

    it('should generate different hashes for different configs', () => {
      const config1: DevcontainerConfig = {
        name: 'test1',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      const config2: DevcontainerConfig = {
        name: 'test2',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git nodejs_22' },
        },
      }

      const hash1 = devcontainerManager.calculateConfigHash(config1)
      const hash2 = devcontainerManager.calculateConfigHash(config2)

      expect(hash1).not.toBe(hash2)
    })

    it('should normalize config before hashing', () => {
      const config1: DevcontainerConfig = {
        name: 'test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git',
            CUSTOM_ARG: 'value',
          },
        },
        containerEnv: {
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://localhost',
        },
      }

      const config2: DevcontainerConfig = {
        name: 'test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            CUSTOM_ARG: 'value',
            NIX_PACKAGES: 'git',
          },
        },
        containerEnv: {
          DATABASE_URL: 'postgres://localhost',
          NODE_ENV: 'development',
        },
      }

      const hash1 = devcontainerManager.calculateConfigHash(config1)
      const hash2 = devcontainerManager.calculateConfigHash(config2)

      expect(hash1).toBe(hash2)
    })
  })

  describe('getTemplate', () => {
    it('should return null for non-existent template', async () => {
      const template = await devcontainerManager.getTemplate('non-existent')
      expect(template).toBeNull()
    })

    it('should retrieve existing template', async () => {
      const config: DevcontainerConfig = {
        name: 'test-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('test-template', config)
      const template = await devcontainerManager.getTemplate('test-template')

      expect(template).not.toBeNull()
      expect(template?.name).toBe('test-template')
      expect(template?.config.build.args.NIX_PACKAGES).toBe('git')
    })
  })

  describe('listTemplates', () => {
    it('should return empty array when no templates exist', async () => {
      const templates = await devcontainerManager.listTemplates()
      expect(templates).toEqual([])
    })

    it('should list all templates', async () => {
      const config1: DevcontainerConfig = {
        name: 'template1',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      const config2: DevcontainerConfig = {
        name: 'template2',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'python3' },
        },
      }

      await devcontainerManager.createTemplate('template1', config1)
      await devcontainerManager.createTemplate('template2', config2)

      const templates = await devcontainerManager.listTemplates()
      expect(templates.length).toBe(2)
    })
  })

  describe('createTemplate', () => {
    it('should create a new template', async () => {
      const config: DevcontainerConfig = {
        name: 'new-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git nodejs_22' },
        },
      }

      const template = await devcontainerManager.createTemplate('new-template', config)

      expect(template.name).toBe('new-template')
      expect(template.isBuiltIn).toBe(false)
      expect(template.config.build.args.NIX_PACKAGES).toBe('git nodejs_22')
    })

    it('should reject duplicate template names', async () => {
      const config: DevcontainerConfig = {
        name: 'duplicate',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('duplicate', config)

      await expect(
        devcontainerManager.createTemplate('duplicate', config)
      ).rejects.toThrow("Template with name 'duplicate' already exists")
    })

    it('should create template based on existing template', async () => {
      const baseConfig: DevcontainerConfig = {
        name: 'base',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
        containerEnv: {
          BASE_VAR: 'base_value',
        },
      }

      await devcontainerManager.createTemplate('base', baseConfig)

      const derivedConfig: DevcontainerConfig = {
        name: 'derived',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'nodejs_22' },
        },
        containerEnv: {
          DERIVED_VAR: 'derived_value',
        },
      }

      const derived = await devcontainerManager.createTemplate(
        'derived',
        derivedConfig,
        'base'
      )

      expect(derived.forkedFrom).toBe('base')
      expect(derived.config.build.args.NIX_PACKAGES).toBe('nodejs_22')
      expect(derived.config.containerEnv?.BASE_VAR).toBe('base_value')
      expect(derived.config.containerEnv?.DERIVED_VAR).toBe('derived_value')
    })

    it('should reject creation with non-existent base template', async () => {
      const config: DevcontainerConfig = {
        name: 'test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await expect(
        devcontainerManager.createTemplate('test', config, 'non-existent')
      ).rejects.toThrow("Base template 'non-existent' not found")
    })
  })

  describe('updateTemplate', () => {
    it('should update existing template', async () => {
      const config: DevcontainerConfig = {
        name: 'update-test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('update-test', config)

      const updatedConfig: DevcontainerConfig = {
        name: 'update-test',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git nodejs_22' },
        },
      }

      await devcontainerManager.updateTemplate('update-test', updatedConfig)

      const template = await devcontainerManager.getTemplate('update-test')
      expect(template?.config.build.args.NIX_PACKAGES).toBe('git nodejs_22')
    })

    it('should reject update of non-existent template', async () => {
      const config: DevcontainerConfig = {
        name: 'non-existent',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await expect(
        devcontainerManager.updateTemplate('non-existent', config)
      ).rejects.toThrow("Template 'non-existent' not found")
    })

    it('should reject update of built-in template', async () => {
      const builtInTemplate = {
        name: 'built-in',
        config: {
          name: 'built-in',
          build: {
            dockerfile: 'Dockerfile.nix',
            context: '.',
            args: { NIX_PACKAGES: 'git' },
          },
        },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, builtInTemplate)

      const updatedConfig: DevcontainerConfig = {
        name: 'built-in',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git nodejs_22' },
        },
      }

      await expect(
        devcontainerManager.updateTemplate('built-in', updatedConfig)
      ).rejects.toThrow("Cannot modify built-in template 'built-in'")
    })

    it('should mark sessions as stale when template updated', async () => {
      const config: DevcontainerConfig = {
        name: 'shared-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('shared-template', config)

      const session = {
        id: 'session-1',
        name: 'session-1',
        repoMappings: [],
        status: 'running' as const,
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'session-1.oc',
        opencodeUrl: 'http://session-1-opencode.oc:5551',
        codeServerUrl: 'https://session-1-code.localhost',
        sessionPath: '/workspace/sessions/session-1',
        opencodeStatePath: '/workspace/sessions/session-1/state',
        dindDataPath: '/workspace/sessions/session-1/docker',
        codeServerConfigPath: '/workspace/sessions/session-1/code-server',
        devcontainerTemplate: 'shared-template',
        devcontainerConfigHash: 'hash1',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)

      const updatedConfig: DevcontainerConfig = {
        name: 'shared-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git nodejs_22' },
        },
      }

      await devcontainerManager.updateTemplate('shared-template', updatedConfig)

      const updatedSession = db.getSessionById(database, 'session-1')
      expect(updatedSession?.status).toBe('stale')
    })
  })

  describe('forkTemplate', () => {
    it('should fork existing template', async () => {
      const originalConfig: DevcontainerConfig = {
        name: 'original',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('original', originalConfig)

      const forked = await devcontainerManager.forkTemplate('original', 'forked')

      expect(forked.name).toBe('forked')
      expect(forked.forkedFrom).toBe('original')
      expect(forked.config.build.args.NIX_PACKAGES).toBe('git')
    })

    it('should reject fork of non-existent template', async () => {
      await expect(
        devcontainerManager.forkTemplate('non-existent', 'new-fork')
      ).rejects.toThrow("Template 'non-existent' not found")
    })
  })

  describe('deleteTemplate', () => {
    it('should delete custom template', async () => {
      const config: DevcontainerConfig = {
        name: 'delete-me',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('delete-me', config)
      await devcontainerManager.deleteTemplate('delete-me')

      const deleted = await devcontainerManager.getTemplate('delete-me')
      expect(deleted).toBeNull()
    })

    it('should reject delete of non-existent template', async () => {
      await expect(
        devcontainerManager.deleteTemplate('non-existent')
      ).rejects.toThrow("Template 'non-existent' not found")
    })

    it('should reject delete of built-in template', async () => {
      const builtInTemplate = {
        name: 'built-in',
        config: {
          name: 'built-in',
          build: {
            dockerfile: 'Dockerfile.nix',
            context: '.',
            args: { NIX_PACKAGES: 'git' },
          },
        },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, builtInTemplate)

      await expect(
        devcontainerManager.deleteTemplate('built-in')
      ).rejects.toThrow("Cannot delete built-in template 'built-in'")
    })

    it('should reject delete of template in use', async () => {
      const config: DevcontainerConfig = {
        name: 'in-use',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
      }

      await devcontainerManager.createTemplate('in-use', config)

      const session = {
        id: 'session-1',
        name: 'session-1',
        repoMappings: [],
        status: 'running' as const,
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'session-1.oc',
        opencodeUrl: 'http://session-1-opencode.oc:5551',
        codeServerUrl: 'https://session-1-code.localhost',
        sessionPath: '/workspace/sessions/session-1',
        opencodeStatePath: '/workspace/sessions/session-1/state',
        dindDataPath: '/workspace/sessions/session-1/docker',
        codeServerConfigPath: '/workspace/sessions/session-1/code-server',
        devcontainerTemplate: 'in-use',
        devcontainerConfigHash: 'hash1',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)

      await expect(
        devcontainerManager.deleteTemplate('in-use')
      ).rejects.toThrow("Cannot delete template 'in-use': 1 sessions are using it")
    })
  })

  describe('config merging', () => {
    it('should merge build args', async () => {
      const baseConfig: DevcontainerConfig = {
        name: 'base',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git',
            CUSTOM_ARG: 'base_value',
          },
        },
      }

      await devcontainerManager.createTemplate('base', baseConfig)

      const derivedConfig: DevcontainerConfig = {
        name: 'derived',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'nodejs_22',
          },
        },
      }

      const derived = await devcontainerManager.createTemplate(
        'derived',
        derivedConfig,
        'base'
      )

      expect(derived.config.build.args.NIX_PACKAGES).toBe('nodejs_22')
      expect(derived.config.build.args.CUSTOM_ARG).toBe('base_value')
    })

    it('should merge container env vars', async () => {
      const baseConfig: DevcontainerConfig = {
        name: 'base',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
        containerEnv: {
          BASE_VAR: 'base',
          SHARED_VAR: 'base_value',
        },
      }

      await devcontainerManager.createTemplate('base', baseConfig)

      const derivedConfig: DevcontainerConfig = {
        name: 'derived',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
        containerEnv: {
          DERIVED_VAR: 'derived',
          SHARED_VAR: 'derived_value',
        },
      }

      const derived = await devcontainerManager.createTemplate(
        'derived',
        derivedConfig,
        'base'
      )

      expect(derived.config.containerEnv?.BASE_VAR).toBe('base')
      expect(derived.config.containerEnv?.DERIVED_VAR).toBe('derived')
      expect(derived.config.containerEnv?.SHARED_VAR).toBe('derived_value')
    })

    it('should merge VS Code extensions', async () => {
      const baseConfig: DevcontainerConfig = {
        name: 'base',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
        customizations: {
          vscode: {
            extensions: ['extension1', 'extension2'],
            settings: {
              'setting1': 'value1',
            },
          },
        },
      }

      await devcontainerManager.createTemplate('base', baseConfig)

      const derivedConfig: DevcontainerConfig = {
        name: 'derived',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git' },
        },
        customizations: {
          vscode: {
            extensions: ['extension3'],
            settings: {
              'setting2': 'value2',
            },
          },
        },
      }

      const derived = await devcontainerManager.createTemplate(
        'derived',
        derivedConfig,
        'base'
      )

      expect(derived.config.customizations?.vscode?.extensions).toEqual([
        'extension1',
        'extension2',
        'extension3',
      ])
      expect(derived.config.customizations?.vscode?.settings).toEqual({
        'setting1': 'value1',
        'setting2': 'value2',
      })
    })
  })
})
