import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearOpenCodeVersionCache,
  installOpenCodeVersion,
  listOpenCodeVersions,
  OpenCodeInstallError,
  resolveOpenCodeBinaryPath,
  resolveOpenCodeInstallTarget,
} from '../../src/services/opencode-installer'

const linuxTarget = { platform: 'linux' as const, arch: 'x64', musl: false }

function createArchive(directory: string, reportedVersion: string): string {
  const payloadPath = join(directory, 'opencode')
  writeFileSync(payloadPath, `#!/bin/sh\necho "opencode v${reportedVersion}"\n`)
  chmodSync(payloadPath, 0o755)

  const archivePath = join(directory, 'opencode.tar.gz')
  const result = spawnSync('tar', ['-czf', archivePath, '-C', directory, 'opencode'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`Failed to build the archive fixture: ${result.stderr}`)
  }

  rmSync(payloadPath, { force: true })
  return archivePath
}

function createDarwinArchive(directory: string, reportedVersion: string): string {
  const content = Buffer.from(`#!/bin/sh\necho "opencode v${reportedVersion}"\n`)
  const name = Buffer.from('opencode')
  const checksum = crc32(content)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(content.length, 18)
  local.writeUInt32LE(content.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(content.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(name.length, 28)

  const centralOffset = local.length + name.length + content.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(centralOffset, 16)

  const archivePath = join(directory, 'opencode.zip')
  writeFileSync(archivePath, Buffer.concat([local, name, content, central, name, end]))
  return archivePath
}

function crc32(buffer: Uint8Array): number {
  let checksum = 0xffffffff
  for (const byte of buffer) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit++) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
    }
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function createFetch(archivePath: string | null, status = 200) {
  const calls: string[] = []
  const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input))
    if (status !== 200 || archivePath === null) {
      return new Response('unavailable', { status })
    }
    return new Response(new Uint8Array(readFileSync(archivePath)), { status })
  }) as typeof fetch
  return { calls, fetchFn }
}

function createRegistryFetch(payload: unknown, status = 200) {
  const calls: string[] = []
  const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input))
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetchFn }
}

function countStagingDirectories(): number {
  const listing = spawnSync('find', [tmpdir(), '-maxdepth', '1', '-name', 'opencode-install-*'], { encoding: 'utf8' })
  return listing.stdout.trim().split('\n').filter(Boolean).length
}

let workDirectory: string

beforeEach(() => {
  workDirectory = mkdtempSync(join(tmpdir(), 'opencode-installer-'))
  clearOpenCodeVersionCache()
})

afterEach(() => {
  rmSync(workDirectory, { recursive: true, force: true })
})

describe('resolveOpenCodeBinaryPath', () => {
  it('resolves the manager-owned install location under the given home directory', () => {
    expect(resolveOpenCodeBinaryPath('/home/node')).toBe('/home/node/.opencode/bin/opencode')
  })
})

describe('resolveOpenCodeInstallTarget', () => {
  it('reports the running platform and architecture', () => {
    const target = resolveOpenCodeInstallTarget()
    expect(target.platform).toBe(process.platform)
    expect(target.arch).toBe(process.arch)
    expect(typeof target.musl).toBe('boolean')
    expect(target.musl && process.platform !== 'linux').toBe(false)
  })
})

describe('installOpenCodeVersion', () => {
  it('downloads, verifies and installs the requested version', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const archivePath = createArchive(workDirectory, '2.0.15')
    const { calls, fetchFn } = createFetch(archivePath)

    const installedPath = await installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    expect(installedPath).toBe(resolveOpenCodeBinaryPath(homeDirectory))
    expect(calls).toEqual(['https://opencode.ai/files/bin/2.0.15/opencode-linux-x64.tar.gz'])
    expect(statSync(installedPath).mode & 0o777).toBe(0o755)
    expect(readFileSync(installedPath, 'utf-8')).toContain('2.0.15')
  })

  it('requests the musl asset for a musl linux target', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const archivePath = createArchive(workDirectory, '2.0.15')
    const { calls, fetchFn } = createFetch(archivePath)

    await installOpenCodeVersion('2.0.15', {
      fetch: fetchFn,
      homeDirectory,
      target: { platform: 'linux', arch: 'arm64', musl: true },
    })

    expect(calls).toEqual(['https://opencode.ai/files/bin/2.0.15/opencode-linux-arm64-musl.tar.gz'])
  })

  it('extracts the darwin zip asset and installs it', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const archivePath = createDarwinArchive(workDirectory, '2.0.15')
    const { calls, fetchFn } = createFetch(archivePath)

    const installedPath = await installOpenCodeVersion('2.0.15', {
      fetch: fetchFn,
      homeDirectory,
      target: { platform: 'darwin', arch: 'arm64', musl: false },
    })

    expect(calls).toEqual(['https://opencode.ai/files/bin/2.0.15/opencode-darwin-arm64.zip'])
    expect(installedPath).toBe(resolveOpenCodeBinaryPath(homeDirectory))
    expect(statSync(installedPath).mode & 0o777).toBe(0o755)
    expect(readFileSync(installedPath, 'utf-8')).toContain('2.0.15')
  })

  it('rejects an OpenCode 1.x version before downloading anything', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const { calls, fetchFn } = createFetch(null)

    await expect(installOpenCodeVersion('1.18.32', { fetch: fetchFn, homeDirectory, target: linuxTarget }))
      .rejects.toThrow('OpenCode 1.18.32 is not supported; OpenCode Manager requires OpenCode >=2.0.15 <3.0.0')
    expect(calls).toEqual([])
  })

  it.each(['2.0.14', '3.0.0', '2.1.0-beta.1', '2.0.15; rm -rf /'])(
    'rejects %s outside the supported stable range before downloading anything',
    async (version) => {
      const homeDirectory = join(workDirectory, 'home')
      const { calls, fetchFn } = createFetch(null)

      await expect(installOpenCodeVersion(version, { fetch: fetchFn, homeDirectory, target: linuxTarget }))
        .rejects.toThrow(/requires OpenCode >=2\.0\.15 <3\.0\.0/)
      expect(calls).toEqual([])
    },
  )

  it('fails and leaves no binary behind when the download is not available', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const { fetchFn } = createFetch(null, 404)

    await expect(installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget }))
      .rejects.toThrow(/404/)
    expect(() => statSync(resolveOpenCodeBinaryPath(homeDirectory))).toThrow()
  })

  it('fails and leaves no binary behind when the archive reports a different version', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const archivePath = createArchive(workDirectory, '2.0.16')
    const { fetchFn } = createFetch(archivePath)

    await expect(installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget }))
      .rejects.toThrow(/2\.0\.15/)
    expect(() => statSync(resolveOpenCodeBinaryPath(homeDirectory))).toThrow()
  })

  it('replaces an existing installed binary with the requested version', async () => {
    const homeDirectory = join(workDirectory, 'home')
    mkdirSync(join(homeDirectory, '.opencode', 'bin'), { recursive: true })
    writeFileSync(resolveOpenCodeBinaryPath(homeDirectory), '#!/bin/sh\necho "opencode v2.0.14"\n')

    const archivePath = createArchive(workDirectory, '2.0.15')
    const { fetchFn } = createFetch(archivePath)

    await installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    expect(readFileSync(resolveOpenCodeBinaryPath(homeDirectory), 'utf-8')).toContain('2.0.15')
  })

  it('cleans up its staging directory after a successful install', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const archivePath = createArchive(workDirectory, '2.0.15')
    const { fetchFn } = createFetch(archivePath)

    const before = countStagingDirectories()
    await installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    expect(countStagingDirectories()).toBe(before)
  })
})

describe('listOpenCodeVersions', () => {
  const registryPayload = {
    versions: {
      '1.18.32': {},
      '2.0.0': {},
      '2.0.14': {},
      '2.0.15': {},
      '2.0.16': {},
      '2.1.0-beta.1': {},
      '3.0.0': {},
      'not-a-version': {},
    },
    time: {
      '2.0.15': '2026-02-01T00:00:00.000Z',
      '2.0.16': '2026-03-01T00:00:00.000Z',
    },
  }

  it('lists only supported stable releases within the pinned major, newest first', async () => {
    const { calls, fetchFn } = createRegistryFetch(registryPayload)

    const versions = await listOpenCodeVersions({ fetch: fetchFn })

    expect(versions).toEqual([
      { version: '2.0.16', publishedAt: '2026-03-01T00:00:00.000Z' },
      { version: '2.0.15', publishedAt: '2026-02-01T00:00:00.000Z' },
    ])
    expect(calls).toEqual(['https://registry.npmjs.org/@opencode/cli'])
  })

  it('reports a null publishedAt when the registry has no timestamp for a version', async () => {
    const { fetchFn } = createRegistryFetch({
      versions: { '2.0.20': {} },
      time: {},
    })

    await expect(listOpenCodeVersions({ fetch: fetchFn })).resolves.toEqual([
      { version: '2.0.20', publishedAt: null },
    ])
  })

  it('serves the cached list within five minutes without refetching', async () => {
    const { calls, fetchFn } = createRegistryFetch(registryPayload)
    let now = 1_000_000

    const first = await listOpenCodeVersions({ fetch: fetchFn, now: () => now })
    now += 5 * 60 * 1000 - 1
    const second = await listOpenCodeVersions({ fetch: fetchFn, now: () => now })

    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
  })

  it('refreshes the list once the five minute cache expires', async () => {
    const stale = createRegistryFetch(registryPayload)
    const fresh = createRegistryFetch({ versions: { '2.0.17': {} }, time: {} })
    let now = 1_000_000

    await listOpenCodeVersions({ fetch: stale.fetchFn, now: () => now })
    now += 5 * 60 * 1000
    const refreshed = await listOpenCodeVersions({ fetch: fresh.fetchFn, now: () => now })

    expect(refreshed).toEqual([{ version: '2.0.17', publishedAt: null }])
    expect(stale.calls).toHaveLength(1)
    expect(fresh.calls).toHaveLength(1)
  })

  it('does not cache a failed registry request', async () => {
    const failing = createRegistryFetch({}, 500)
    const working = createRegistryFetch(registryPayload)

    await expect(listOpenCodeVersions({ fetch: failing.fetchFn })).rejects.toThrow(/500/)
    await expect(listOpenCodeVersions({ fetch: working.fetchFn })).resolves.toHaveLength(2)
    expect(working.calls).toHaveLength(1)
  })
})

describe('OpenCodeInstallError swap signalling', () => {
  it('marks an unsupported version as not having started the binary swap', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const { calls, fetchFn } = createFetch(null)

    const promise = installOpenCodeVersion('1.18.32', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    await expect(promise).rejects.toBeInstanceOf(OpenCodeInstallError)
    await expect(promise).rejects.toMatchObject({ swapStarted: false })
    expect(calls).toEqual([])
  })

  it('marks a pre-swap download failure as not having started the binary swap', async () => {
    const homeDirectory = join(workDirectory, 'home')
    const { fetchFn } = createFetch(null, 404)

    const promise = installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    await expect(promise).rejects.toBeInstanceOf(OpenCodeInstallError)
    await expect(promise).rejects.toMatchObject({ swapStarted: false })
    expect(() => statSync(resolveOpenCodeBinaryPath(homeDirectory))).toThrow()
  })

  it('marks a failure while replacing the binary as having started the binary swap', async () => {
    const homeDirectory = join(workDirectory, 'home')
    mkdirSync(resolveOpenCodeBinaryPath(homeDirectory), { recursive: true })
    const archivePath = createArchive(workDirectory, '2.0.15')
    const { fetchFn } = createFetch(archivePath)

    const promise = installOpenCodeVersion('2.0.15', { fetch: fetchFn, homeDirectory, target: linuxTarget })

    await expect(promise).rejects.toBeInstanceOf(OpenCodeInstallError)
    await expect(promise).rejects.toMatchObject({ swapStarted: true })
  })
})
