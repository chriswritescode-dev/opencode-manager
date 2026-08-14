import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'

const entrypointPath = join(repoRoot, 'scripts/docker-entrypoint.sh')

let stubDir: string
let logPath: string

const writeStub = (name: string, body: string) => {
  const file = join(stubDir, name)
  writeFileSync(file, `#!/bin/bash\n${body}\n`)
  chmodSync(file, 0o755)
}

const extractGrantKvmAccess = () => {
  const entrypoint = readFileSync(entrypointPath, 'utf-8')
  const match = entrypoint.match(/^grant_kvm_access\(\) \{\n[\s\S]*?\n\}/m)
  if (!match) throw new Error('grant_kvm_access() not found in docker-entrypoint.sh')
  return match[0]
}

beforeEach(() => {
  stubDir = join(tmpdir(), `ocm-entrypoint-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(stubDir, { recursive: true })
  logPath = join(stubDir, 'calls.log')

  writeStub('stat', `echo "${'${OCM_STUB_DEV_GID:-44}'}"`)
  writeStub('getent', `
if [ "$1" = "group" ] && [ "$2" = "${'${OCM_STUB_DEV_GID:-44}'}" ]; then
  echo "${'${OCM_STUB_GROUP_HOLDER}'}:x:$2:"
  exit 0
fi
exit 2`)
  writeStub('groupadd', `echo "groupadd $*" >> "$OCM_STUB_LOG"`)
  writeStub('usermod', `echo "usermod $*" >> "$OCM_STUB_LOG"`)
  writeStub('runuser', `echo "runuser $*" >> "$OCM_STUB_LOG"
exit ${'${OCM_STUB_RUNUSER_EXIT:-0}'}`)
})

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true })
})

const runScript = (snippet: string, env: Record<string, string> = {}) => {
  const scriptPath = join(stubDir, 'test.sh')
  writeFileSync(scriptPath, `set -e\n${extractGrantKvmAccess()}\n${snippet}\n`)
  return spawnSync('bash', [scriptPath], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      OCM_STUB_LOG: logPath,
      ...env,
    },
  })
}

const stubCalls = () => {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
}

const mockDevice = () => {
  const dev = join(stubDir, 'dev-kvm')
  writeFileSync(dev, '')
  return dev
}

describe('grant_kvm_access', () => {
  it('is a no-op when the device does not exist', () => {
    const res = runScript(`grant_kvm_access ${JSON.stringify(join(stubDir, 'missing-device'))}; echo ok`)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('ok')
    expect(stubCalls()).toEqual([])
  })

  it('is a no-op when the device gid is not numeric', () => {
    const res = runScript(`grant_kvm_access ${JSON.stringify(mockDevice())}; echo ok`, {
      OCM_STUB_DEV_GID: 'abc',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('ok')
    expect(stubCalls()).toEqual([])
  })

  it('reuses the existing group holding the device gid', () => {
    const dev = mockDevice()
    const res = runScript(`grant_kvm_access ${JSON.stringify(dev)}; echo ok`, {
      OCM_STUB_DEV_GID: '44',
      OCM_STUB_GROUP_HOLDER: 'video',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Granted node access')
    expect(stubCalls().some((c) => c === 'usermod -aG video node')).toBe(true)
    expect(stubCalls().some((c) => c.startsWith('runuser -u node -- test -r'))).toBe(true)
    expect(stubCalls().some((c) => c.startsWith('runuser -u node -- test -w'))).toBe(true)
  })

  it('creates a matching group when none holds the device gid', () => {
    const dev = mockDevice()
    const res = runScript(`grant_kvm_access ${JSON.stringify(dev)}; echo ok`, {
      OCM_STUB_DEV_GID: '232',
      OCM_STUB_GROUP_HOLDER: '',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Granted node access')
    expect(stubCalls().some((c) => c === 'groupadd -g 232 kvm')).toBe(true)
    expect(stubCalls().some((c) => c.startsWith('usermod -aG kvm node'))).toBe(true)
  })

  it('fails clearly when the group cannot be created', () => {
    writeStub('groupadd', `echo "groupadd $*" >> "$OCM_STUB_LOG"\nexit 1`)
    const dev = mockDevice()
    const res = runScript(`grant_kvm_access ${JSON.stringify(dev)} || echo "failed"`, {
      OCM_STUB_DEV_GID: '232',
      OCM_STUB_GROUP_HOLDER: '',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('failed')
    expect(res.stderr).toMatch(/could not create group/)
  })

  it('fails clearly when node cannot be added to the group', () => {
    writeStub('usermod', `echo "usermod $*" >> "$OCM_STUB_LOG"\nexit 1`)
    const dev = mockDevice()
    const res = runScript(`grant_kvm_access ${JSON.stringify(dev)} || echo "failed"`, {
      OCM_STUB_GROUP_HOLDER: 'video',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('failed')
    expect(res.stderr).toMatch(/could not add node to group/)
  })

  it('fails clearly when the node user cannot open the device', () => {
    const dev = mockDevice()
    const res = runScript(`grant_kvm_access ${JSON.stringify(dev)} || echo "failed"`, {
      OCM_STUB_GROUP_HOLDER: 'video',
      OCM_STUB_RUNUSER_EXIT: '1',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('failed')
    expect(res.stderr).toMatch(/node cannot access/)
  })
})

const extractInstallOpencode = () => {
  const entrypoint = readFileSync(entrypointPath, 'utf-8')
  const match = entrypoint.match(/^install_opencode\(\) \{\n[\s\S]*?\n\}/m)
  if (!match) throw new Error('install_opencode() not found in docker-entrypoint.sh')
  return match[0]
}

const extractOpenCodeInstallSection = () => {
  const entrypoint = readFileSync(entrypointPath, 'utf-8')
  const startMarker = 'echo "Checking OpenCode installation..."'
  const endMarker = 'echo "Starting OpenCode Manager Backend..."'
  const start = entrypoint.indexOf(startMarker)
  const end = entrypoint.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('OpenCode install section not found in docker-entrypoint.sh')
  }
  return entrypoint.slice(start, end)
}

const runOpenCodeSection = (snippet: string, env: Record<string, string> = {}) => {
  const scriptPath = join(stubDir, 'test.sh')
  const homeDir = join(stubDir, 'home')
  writeFileSync(scriptPath, `set -e\n${snippet}\n`)
  return spawnSync('bash', [scriptPath], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${stubDir}:${homeDir}/.opencode/bin:/usr/bin:/bin`,
      OCM_STUB_LOG: logPath,
      HOME: homeDir,
      OPENCODE_BUNDLED_VERSION: '1.18.16',
      ...env,
    },
  })
}

const stubInstallTools = () => {
  writeStub('curl', `echo "curl $*" >> "$OCM_STUB_LOG"
rm -rf /tmp/opencode /tmp/opencode.tar.gz
mkdir -p "$HOME/.opencode/bin"
printf '#!/bin/bash\\necho 1.18.16\\n' > "$HOME/.opencode/bin/opencode"
chmod +x "$HOME/.opencode/bin/opencode"
printf 'fake binary\\n' > /tmp/opencode`)
  writeStub('tar', `echo "tar $*" >> "$OCM_STUB_LOG"`)
}

const curlLog = () => stubCalls().filter((c) => c.startsWith('curl '))

describe('install_opencode', () => {
  it('installs the bundled verified version, never latest', () => {
    stubInstallTools()
    const res = runOpenCodeSection(`${extractInstallOpencode()}\ninstall_opencode`)
    expect(res.status).toBe(0)
    const urls = curlLog().join(' ')
    expect(urls).toMatch(/\/releases\/download\/v1\.18\.16\//)
    expect(urls).not.toContain('/releases/latest/download/')
  })

  it('refuses to guess the pinned build when OPENCODE_BUNDLED_VERSION is unset', () => {
    stubInstallTools()
    const res = runOpenCodeSection(`${extractInstallOpencode()}\ninstall_opencode`, {
      OPENCODE_BUNDLED_VERSION: '',
    })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('OPENCODE_BUNDLED_VERSION is not set')
    expect(curlLog()).toHaveLength(0)
  })

  it('honors an OPENCODE_BUNDLED_VERSION override for the download URL', () => {
    stubInstallTools()
    const res = runOpenCodeSection(`${extractInstallOpencode()}\ninstall_opencode`, {
      OPENCODE_BUNDLED_VERSION: '1.22.0',
    })
    expect(res.status).toBe(0)
    const urls = curlLog().join(' ')
    expect(urls).toMatch(/\/releases\/download\/v1\.22\.0\//)
    expect(urls).not.toContain('/releases/latest/download/')
  })

  it('reinstalls the bundled verified version when opencode is missing', () => {
    stubInstallTools()
    const res = runOpenCodeSection(`${extractInstallOpencode()}\n${extractOpenCodeInstallSection()}`)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('OpenCode not found. Installing...')
    const urls = curlLog().join(' ')
    expect(urls).toMatch(/\/releases\/download\/v1\.18\.16\//)
    expect(urls).not.toContain('/releases/latest/download/')
  })

  it('repairs a below-minimum opencode with the bundled verified version, not latest', () => {
    stubInstallTools()
    writeStub('opencode', `echo "opencode version 1.0.0"`)
    const res = runOpenCodeSection(`${extractInstallOpencode()}\n${extractOpenCodeInstallSection()}`)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('below minimum required version')
    const urls = curlLog().join(' ')
    expect(urls).toMatch(/\/releases\/download\/v1\.18\.16\//)
    expect(urls).not.toContain('/releases/latest/download/')
  })
})
