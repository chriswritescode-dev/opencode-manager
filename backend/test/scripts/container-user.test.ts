import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'

const libPath = join(repoRoot, 'scripts/lib/container-user.sh')

let stubDir: string
let logPath: string

const writeStub = (name: string, body: string) => {
  const file = join(stubDir, name)
  writeFileSync(file, `#!/bin/bash\n${body}\n`)
  chmodSync(file, 0o755)
}

beforeEach(() => {
  stubDir = join(tmpdir(), `ocm-container-user-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(stubDir, { recursive: true })
  logPath = join(stubDir, 'calls.log')

  writeStub('id', `
case "$1" in
  -u) echo "${'${OCM_STUB_NODE_UID:-1000}'}" ;;
  -g) echo "${'${OCM_STUB_NODE_GID:-1000}'}" ;;
  *) exit 1 ;;
esac`)

  writeStub('getent', `
if [ "$1" = "group" ] && [ "$2" = "${'${OCM_STUB_GID_KEY:-__none__}'}" ]; then
  echo "${'${OCM_STUB_GID_HOLDER}'}:x:$2:"
  exit 0
fi
if [ "$1" = "passwd" ] && [ "$2" = "${'${OCM_STUB_UID_KEY:-__none__}'}" ]; then
  echo "${'${OCM_STUB_UID_HOLDER}'}:x:$2:$2::/nonexistent:/bin/false"
  exit 0
fi
exit 2`)

  writeStub('groupmod', `echo "groupmod $*" >> "$OCM_STUB_LOG"`)
  writeStub('usermod', `echo "usermod $*" >> "$OCM_STUB_LOG"`)
  writeStub('stat', `echo "${'${OCM_STUB_OWNER_UID:-0}'}"`)
})

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true })
})

const runScript = (snippet: string, env: Record<string, string> = {}) =>
  spawnSync('bash', ['-c', 'set -e\nsource "$1"\n$2', '--', libPath, snippet], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PUID: '',
      PGID: '',
      PATH: `${stubDir}:${process.env.PATH}`,
      OCM_STUB_LOG: logPath,
      ...env,
    },
  })

const stubCalls = () => {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
}

describe('resolve_target_ids', () => {
  it('defaults PUID/PGID to 1000 when unset', () => {
    const res = runScript('unset PUID PGID; resolve_target_ids; echo "uid=$OCM_TARGET_UID gid=$OCM_TARGET_GID"')
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('uid=1000 gid=1000')
  })

  it('honors explicit PUID and PGID values', () => {
    const res = runScript('resolve_target_ids; echo "uid=$OCM_TARGET_UID gid=$OCM_TARGET_GID"', {
      PUID: '1001',
      PGID: '1002',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('uid=1001 gid=1002')
  })

  it('rejects non-numeric PUID with the offending value in stderr', () => {
    const res = runScript('resolve_target_ids', { PUID: 'abc' })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/PUID must be a numeric user id/)
    expect(res.stderr).toContain('abc')
  })

  it('rejects non-numeric PGID', () => {
    const res = runScript('resolve_target_ids', { PGID: '1x0' })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/PGID must be a numeric group id/)
  })

  it('falls back to 1000 when PUID is explicitly empty', () => {
    const res = runScript('resolve_target_ids; echo "uid=$OCM_TARGET_UID"', { PUID: '' })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('uid=1000')
  })
})

describe('align_container_user', () => {
  it('is a no-op when ids already match', () => {
    const res = runScript(
      'align_container_user node; echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_UID: '1000', OCM_STUB_NODE_GID: '1000', PUID: '1000', PGID: '1000' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual([])
    expect(res.stdout).toContain('uidChanged=0 gidChanged=0')
  })

  it('aligns both ids and records the change, group before user', () => {
    const res = runScript(
      'align_container_user node; echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_UID: '1000', OCM_STUB_NODE_GID: '1000', PUID: '1001', PGID: '1002' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['groupmod -g 1002 node', 'usermod -u 1001 node'])
    expect(res.stdout).toContain('uidChanged=1 gidChanged=1')
  })

  it('aligns only the gid when the uid already matches', () => {
    const res = runScript(
      'align_container_user node; echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_UID: '1001', PUID: '1001', PGID: '1002' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['groupmod -g 1002 node'])
    expect(res.stdout).toContain('uidChanged=0 gidChanged=1')
  })

  it('aligns only the uid when the gid already matches', () => {
    const res = runScript(
      'align_container_user node; echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_GID: '1002', PUID: '1001', PGID: '1002' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['usermod -u 1001 node'])
    expect(res.stdout).toContain('uidChanged=1 gidChanged=0')
  })

  it('defaults the account name to node', () => {
    const res = runScript('align_container_user', { PUID: '1001' })
    expect(res.status).toBe(0)
    expect(stubCalls().some((c) => c.endsWith(' node'))).toBe(true)
  })

  it('rejects malformed ids before touching accounts', () => {
    const res = runScript('align_container_user node', { PUID: 'abc' })
    expect(res.status).not.toBe(0)
    expect(stubCalls()).toEqual([])
  })

  it('logs what it is doing', () => {
    const res = runScript('align_container_user node', { PUID: '1001', PGID: '1002' })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/Aligning node group to gid 1002/)
    expect(res.stdout).toMatch(/Aligning node user to uid 1001/)
  })

  it('propagates groupmod failure without setting the gid change flag', () => {
    writeStub('groupmod', `echo "groupmod $*" >> "$OCM_STUB_LOG"\nexit 1`)
    const res = runScript(
      'align_container_user node || echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_UID: '1000', OCM_STUB_NODE_GID: '1000', PUID: '1001', PGID: '1002' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['groupmod -g 1002 node'])
    expect(res.stdout).toContain('uidChanged=0 gidChanged=0')
  })

  it('propagates usermod failure without setting the uid change flag', () => {
    writeStub('usermod', `echo "usermod $*" >> "$OCM_STUB_LOG"\nexit 1`)
    const res = runScript(
      'align_container_user node || echo "uidChanged=$OCM_UID_CHANGED gidChanged=$OCM_GID_CHANGED"',
      { OCM_STUB_NODE_UID: '1000', OCM_STUB_NODE_GID: '1000', PUID: '1001', PGID: '1002' },
    )
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['groupmod -g 1002 node', 'usermod -u 1001 node'])
    expect(res.stdout).toContain('uidChanged=0 gidChanged=1')
  })
})

describe('align_container_user id collisions', () => {
  it('aborts before mutating anything when the gid is held by another group', () => {
    const res = runScript('align_container_user node', {
      OCM_STUB_NODE_UID: '1000',
      OCM_STUB_NODE_GID: '1000',
      PUID: '1001',
      PGID: '100',
      OCM_STUB_GID_KEY: '100',
      OCM_STUB_GID_HOLDER: 'users',
    })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('PGID 100')
    expect(res.stderr).toContain('users')
    expect(res.stderr).toContain('id -g')
    expect(stubCalls()).toEqual([])
  })

  it('aborts after a successful gid alignment when the uid is held by another user', () => {
    const res = runScript('align_container_user node', {
      OCM_STUB_NODE_UID: '1000',
      OCM_STUB_NODE_GID: '1000',
      PUID: '4',
      PGID: '1002',
      OCM_STUB_UID_KEY: '4',
      OCM_STUB_UID_HOLDER: 'sync',
    })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('PUID 4')
    expect(res.stderr).toContain('sync')
    expect(stubCalls()).toEqual(['groupmod -g 1002 node'])
  })

  it('treats a gid already owned by the target account as a no-collision', () => {
    const res = runScript('align_container_user node', {
      OCM_STUB_NODE_GID: '1000',
      PGID: '1002',
      OCM_STUB_GID_KEY: '1002',
      OCM_STUB_GID_HOLDER: 'node',
    })
    expect(res.status).toBe(0)
    expect(stubCalls()).toContain('groupmod -g 1002 node')
  })

  it('treats a uid already owned by the target account as a no-collision', () => {
    const res = runScript('align_container_user node', {
      OCM_STUB_NODE_UID: '1000',
      PUID: '1001',
      PGID: '1000',
      OCM_STUB_UID_KEY: '1001',
      OCM_STUB_UID_HOLDER: 'node',
    })
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual(['usermod -u 1001 node'])
  })

  it('emits an actionable remediation hint in the collision message', () => {
    const gidCollision = runScript('align_container_user node', {
      OCM_STUB_NODE_UID: '1000',
      OCM_STUB_NODE_GID: '1000',
      PUID: '1001',
      PGID: '100',
      OCM_STUB_GID_KEY: '100',
      OCM_STUB_GID_HOLDER: 'users',
    })
    expect(gidCollision.status).not.toBe(0)
    expect(gidCollision.stderr).toMatch(/Pick a different PGID/)

    const uidCollision = runScript('align_container_user node', {
      OCM_STUB_NODE_UID: '1000',
      OCM_STUB_NODE_GID: '1000',
      PUID: '4',
      PGID: '1002',
      OCM_STUB_UID_KEY: '4',
      OCM_STUB_UID_HOLDER: 'sync',
    })
    expect(uidCollision.status).not.toBe(0)
    expect(uidCollision.stderr).toMatch(/Pick a different PUID/)
  })
})

describe('warn_if_workspace_owner_differs', () => {
  it('is silent when the path does not exist', () => {
    const res = runScript(`warn_if_workspace_owner_differs "${join(stubDir, 'does-not-exist')}" 1000`)
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
  })

  it('is silent when the directory is empty', () => {
    const ws = join(stubDir, 'ws')
    mkdirSync(ws, { recursive: true })
    const res = runScript(`warn_if_workspace_owner_differs "${ws}" 1000`, { OCM_STUB_OWNER_UID: '0' })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
  })

  it('is silent when the directory is non-empty and the owner matches', () => {
    const ws = join(stubDir, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'repo.txt'), 'data')
    const res = runScript(`warn_if_workspace_owner_differs "${ws}" 1000`, { OCM_STUB_OWNER_UID: '1000' })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
  })

  it('warns non-fatally when a non-empty directory has a mismatched owner', () => {
    const ws = join(stubDir, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'repo.txt'), 'data')
    const res = runScript(`warn_if_workspace_owner_differs "${ws}" 1000`, { OCM_STUB_OWNER_UID: '1001' })
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('1001')
    expect(res.stderr).toContain('1000')
    expect(res.stderr).toContain('WARNING')
    expect(res.stderr).toContain(ws)
    expect(res.stderr).toMatch(/rewriting ownership/)
  })

  it('names the id -u / id -g remediation in the warning', () => {
    const ws = join(stubDir, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'repo.txt'), 'data')
    const res = runScript(`warn_if_workspace_owner_differs "${ws}" 1000`, { OCM_STUB_OWNER_UID: '1001' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/id -u/)
    expect(res.stderr).toMatch(/id -g/)
  })

  it('stays silent and returns 0 when stat fails under set -e', () => {
    const ws = join(stubDir, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'repo.txt'), 'data')
    writeStub('stat', `exit 1`)
    const res = runScript(`warn_if_workspace_owner_differs "${ws}" 1000; echo "status=$?"`, {
      OCM_STUB_OWNER_UID: '1001',
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('status=0')
  })
})
