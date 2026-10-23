import { describe, it, expect } from 'vitest'
import { ENV } from '@opencode-manager/shared/config/env'
import {
  isReservedPreviewPort,
  listListeningPorts,
  parseLsofCwds,
  parseLsofListen,
  parseProcNetTcp,
  type PortDiscoveryDeps,
} from '../../../src/services/preview/ports'

const PROC_HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'

function procRow(local: string, remote: string, state: string, inode: string): string {
  return `   0: ${local} ${remote} ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`
}

const IPV4_FIXTURE = [
  PROC_HEADER,
  procRow('00000000:1435', '00000000:0000', '0A', '11111'),
  procRow('0100007F:1F90', '00000000:0000', '0A', '22222'),
  procRow('0501A8C0:1F90', '00000000:0000', '0A', '33333'),
  procRow('0100007F:1435', '0100007F:9C40', '01', '44444'),
  procRow('0B00007F:8F71', '00000000:0000', '0A', '88888'),
].join('\n')

const IPV6_FIXTURE = [
  PROC_HEADER,
  procRow('00000000000000000000000001000000:0BB8', '00000000000000000000000000000000:0000', '0A', '55555'),
  procRow('00000000000000000000000000000000:1F90', '00000000000000000000000000000000:0000', '0A', '66666'),
  procRow('b80d0120000000000000000001000000:1F90', '00000000000000000000000000000000:0000', '0A', '77777'),
].join('\n')

interface FakeFileSystem {
  files: Record<string, string>
  links: Record<string, string>
  dirs: Record<string, string[]>
}

function createDeps(fs: FakeFileSystem, overrides: Partial<PortDiscoveryDeps> = {}): PortDiscoveryDeps {
  return {
    platform: 'linux',
    readFile: async (path) => {
      const value = fs.files[path]
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    readdir: async (path) => {
      const value = fs.dirs[path]
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    readlink: async (path) => {
      const value = fs.links[path]
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    runLsof: async () => '',
    runLsofCwd: async () => '',
    ...overrides,
  }
}

describe('parseProcNetTcp', () => {
  it('keeps loopback and wildcard IPv4 listeners and drops other rows', () => {
    const sockets = parseProcNetTcp(IPV4_FIXTURE, 4)

    expect(sockets).toEqual([
      { port: 5173, address: '0.0.0.0', inode: '11111' },
      { port: 8080, address: '127.0.0.1', inode: '22222' },
    ])
  })

  it('drops loopback aliases such as Docker embedded DNS', () => {
    const sockets = parseProcNetTcp(IPV4_FIXTURE, 4)

    expect(sockets.map((socket) => socket.address)).not.toContain('127.0.0.11')
  })

  it('decodes little-endian IPv6 addresses and keeps loopback and wildcard', () => {
    const sockets = parseProcNetTcp(IPV6_FIXTURE, 6)

    expect(sockets).toEqual([
      { port: 3000, address: '::1', inode: '55555' },
      { port: 8080, address: '::', inode: '66666' },
    ])
  })
})

describe('parseLsofListen', () => {
  it('parses pid, command and port from field output', () => {
    const output = ['p1234', 'cnode', 'n127.0.0.1:5173', 'p5678', 'cnginx', 'n*:8080'].join('\n')

    expect(parseLsofListen(output)).toEqual([
      { port: 5173, address: '127.0.0.1', pid: 1234, command: 'node' },
      { port: 8080, address: '0.0.0.0', pid: 5678, command: 'nginx' },
    ])
  })

  it('parses bracketed IPv6 names', () => {
    const output = ['p42', 'cdeno', 'n[::1]:3000'].join('\n')

    expect(parseLsofListen(output)).toEqual([
      { port: 3000, address: '::1', pid: 42, command: 'deno' },
    ])
  })
})

describe('parseLsofCwds', () => {
  it('maps pid to working directory, keeping spaces and ignoring fd lines', () => {
    const output = [
      'p777',
      'fcwd',
      'n/Users/dev/my project',
      'p888',
      'fcwd',
      'n/Users/dev/api',
    ].join('\n')

    expect(parseLsofCwds(output)).toEqual(
      new Map([
        [777, '/Users/dev/my project'],
        [888, '/Users/dev/api'],
      ]),
    )
  })
})

describe('isReservedPreviewPort', () => {
  it('reserves the manager, opencode and preview ports', () => {
    expect(isReservedPreviewPort(ENV.SERVER.PORT)).toBe(true)
    expect(isReservedPreviewPort(ENV.OPENCODE.PORT)).toBe(true)
    expect(isReservedPreviewPort(ENV.PREVIEW.PORT)).toBe(true)
    expect(isReservedPreviewPort(5173)).toBe(false)
  })
})

describe('listListeningPorts', () => {
  it('maps inode to pid, command and cwd and excludes reserved and privileged ports', async () => {
    const deps = createDeps({
      files: {
        '/proc/net/tcp': [
          PROC_HEADER,
          procRow('00000000:1435', '00000000:0000', '0A', '11111'),
          procRow('00000000:0050', '00000000:0000', '0A', '33333'),
          procRow(`00000000:${ENV.SERVER.PORT.toString(16).toUpperCase().padStart(4, '0')}`, '00000000:0000', '0A', '22222'),
        ].join('\n'),
        '/proc/1234/comm': 'node\n',
      },
      links: {
        '/proc/1234/fd/3': 'socket:[11111]',
        '/proc/1234/cwd': '/home/user/project',
        '/proc/1234/fd/4': 'socket:[33333]',
        '/proc/9999/fd/2': 'socket:[22222]',
        '/proc/9999/cwd': '/srv/api',
        '/proc/9999/comm': 'bun\n',
      },
      dirs: {
        '/proc': ['1234', '9999', 'self', 'cpuinfo'],
        '/proc/1234/fd': ['0', '3', '4'],
        '/proc/9999/fd': ['2'],
      },
    })

    const ports = await listListeningPorts(deps)

    expect(ports).toEqual([
      { port: 5173, host: '127.0.0.1', pid: 1234, command: 'node', cwd: '/home/user/project' },
    ])
  })

  it('stops scanning process fd directories once every listening inode is mapped', async () => {
    const base = createDeps({
      files: {
        '/proc/net/tcp': [PROC_HEADER, procRow('00000000:1435', '00000000:0000', '0A', '11111')].join('\n'),
        '/proc/1234/comm': 'node\n',
      },
      links: {
        '/proc/1234/fd/3': 'socket:[11111]',
        '/proc/1234/cwd': '/home/user/project',
        '/proc/9999/fd/2': 'socket:[11111]',
      },
      dirs: {
        '/proc': ['1234', '9999'],
        '/proc/1234/fd': ['3'],
        '/proc/9999/fd': ['2'],
      },
    })
    const readdirCalls: string[] = []
    const deps: PortDiscoveryDeps = {
      ...base,
      readdir: async (path) => {
        readdirCalls.push(path)
        return base.readdir(path)
      },
    }

    const ports = await listListeningPorts(deps)

    expect(ports).toEqual([
      { port: 5173, host: '127.0.0.1', pid: 1234, command: 'node', cwd: '/home/user/project' },
    ])
    expect(readdirCalls).toContain('/proc/1234/fd')
    expect(readdirCalls).not.toContain('/proc/9999/fd')
  })

  it('reports an IPv6 loopback host only when the sole listener is IPv6 loopback', async () => {
    const deps = createDeps({
      files: {
        '/proc/net/tcp': '',
        '/proc/net/tcp6': [
          PROC_HEADER,
          procRow('00000000000000000000000001000000:0BB8', '00000000000000000000000000000000:0000', '0A', '55555'),
          procRow('00000000000000000000000001000000:1F90', '00000000000000000000000000000000:0000', '0A', '66666'),
          procRow('00000000000000000000000000000000:1F90', '00000000000000000000000000000000:0000', '0A', '77777'),
        ].join('\n'),
        '/proc/1234/comm': 'vite\n',
      },
      links: {
        '/proc/1234/fd/5': 'socket:[55555]',
        '/proc/1234/fd/6': 'socket:[66666]',
        '/proc/1234/fd/7': 'socket:[77777]',
        '/proc/1234/cwd': '/home/user/app',
      },
      dirs: {
        '/proc': ['1234'],
        '/proc/1234/fd': ['5', '6', '7'],
      },
    })

    const ports = await listListeningPorts(deps)

    expect(ports).toEqual([
      { port: 3000, host: '::1', pid: 1234, command: 'vite', cwd: '/home/user/app' },
      { port: 8080, host: '127.0.0.1', pid: 1234, command: 'vite', cwd: '/home/user/app' },
    ])
  })

  it('maps cwd per pid from a second lsof call and passes each pid once', async () => {
    const cwdCalls: number[][] = []
    const deps = createDeps(
      { files: {}, links: {}, dirs: {} },
      {
        platform: 'darwin',
        runLsof: async () =>
          ['p777', 'cnode', 'n127.0.0.1:5173', 'p888', 'cbun', 'n127.0.0.1:3000', 'n127.0.0.1:5174'].join('\n'),
        runLsofCwd: async (pids) => {
          cwdCalls.push(pids)
          return ['p777', 'fcwd', 'n/Users/dev/app', 'p888', 'fcwd', 'n/Users/dev/api'].join('\n')
        },
      },
    )

    expect(await listListeningPorts(deps)).toEqual([
      { port: 3000, host: '127.0.0.1', pid: 888, command: 'bun', cwd: '/Users/dev/api' },
      { port: 5173, host: '127.0.0.1', pid: 777, command: 'node', cwd: '/Users/dev/app' },
      { port: 5174, host: '127.0.0.1', pid: 888, command: 'bun', cwd: '/Users/dev/api' },
    ])
    expect(cwdCalls).toEqual([[777, 888]])
  })

  it('drops loopback aliases from lsof listeners', async () => {
    const deps = createDeps(
      { files: {}, links: {}, dirs: {} },
      {
        platform: 'darwin',
        runLsof: async () => ['p999', 'cdockerd', 'n127.0.0.11:36721'].join('\n'),
        runLsofCwd: async () => '',
      },
    )

    expect(await listListeningPorts(deps)).toEqual([])
  })

  it('keeps cwd null when the cwd lsof call rejects but still lists the ports', async () => {
    const deps = createDeps(
      { files: {}, links: {}, dirs: {} },
      {
        platform: 'darwin',
        runLsof: async () => ['p777', 'cnode', 'n127.0.0.1:5173'].join('\n'),
        runLsofCwd: async () => {
          throw new Error('lsof failed')
        },
      },
    )

    expect(await listListeningPorts(deps)).toEqual([
      { port: 5173, host: '127.0.0.1', pid: 777, command: 'node', cwd: null },
    ])
  })

  it('returns an empty list on unsupported platforms', async () => {
    const deps = createDeps({ files: {}, links: {}, dirs: {} }, { platform: 'win32' })

    expect(await listListeningPorts(deps)).toEqual([])
  })
})
