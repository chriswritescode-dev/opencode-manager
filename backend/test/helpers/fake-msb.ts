export const FAKE_MSB_STATE_ENV = 'OCM_FAKE_MSB_STATE_DIR'

export const FAKE_MSB_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const stateDir = process.env.${FAKE_MSB_STATE_ENV}
const args = process.argv.slice(2)

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function stdout(text) {
  process.stdout.write(text)
}

function stderrExit(message, code) {
  process.stderr.write(message)
  process.exit(typeof code === 'number' ? code : 1)
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function valuesAfter(flag) {
  const values = []
  for (let index = 0; index < args.length; index++) {
    const value = args[index + 1]
    if (args[index] === flag && value !== undefined) values.push(value)
  }
  return values
}

function clearInspect(name) {
  const persistent = spec.persistentOverrides || []
  if (persistent.includes(name)) return
  fs.rmSync(path.join(stateDir, 'vms', name, 'inspect.json'), { force: true })
}

function readFailure(key) {
  const file = path.join(stateDir, 'fail-' + key)
  if (!fs.existsSync(file)) return null
  const parsed = readJson(file, null)
  const failure = parsed && typeof parsed.stderr === 'string'
    ? { stderr: parsed.stderr, exitCode: parsed.exitCode, once: parsed.once === true }
    : { stderr: fs.readFileSync(file, 'utf8').trim(), exitCode: 1, once: false }
  if (failure.once) fs.rmSync(file, { force: true })
  return failure
}

function fail(key) {
  const failure = readFailure(key)
  if (!failure) return false
  stderrExit(failure.stderr, failure.exitCode)
}

function waitGate(kind) {
  const gate = path.join(stateDir, 'gate-' + kind)
  if (!fs.existsSync(gate)) return
  fs.writeFileSync(path.join(stateDir, 'waiting-' + kind), '1')
  while (fs.existsSync(gate)) sleep(5)
}

if (!stateDir) stderrExit('missing ${FAKE_MSB_STATE_ENV}', 2)
fs.mkdirSync(stateDir, { recursive: true })
fs.appendFileSync(
  path.join(stateDir, 'calls.jsonl'),
  JSON.stringify({ argv: [process.argv[1]].concat(args) }) + '\\n',
)

const spec = readJson(path.join(stateDir, 'spec.json'), {})
const statePath = path.join(stateDir, 'state.json')
const state = readJson(statePath, { vms: {} })
state.vms = state.vms || {}
const saveState = () => writeJson(statePath, state)

function tmpfsSize(memoryMib) {
  return Math.min(512, Math.max(1, Math.floor(memoryMib / 4)))
}

function mountOptions() {
  return { readonly: false, noexec: false, nosuid: false, nodev: false }
}

function synthesize(vm, name) {
  const mounts = []
  const hosts = new Set()
  const roots = (vm.projectMounts || []).concat(spec.sharedMountRoots || [])
  for (const host of roots) {
    if (hosts.has(host)) continue
    hosts.add(host)
    mounts.push({
      type: 'Bind',
      host,
      guest: host,
      options: mountOptions(),
      stat_virtualization: 'strict',
      host_permissions: 'private',
      follow_root_symlinks: false,
      quota_mib: null,
    })
  }
  mounts.push({
    type: 'Named',
    name: name + (spec.dockerVolumeSuffix || '-docker-data'),
    guest: spec.dockerGuestPath,
    options: mountOptions(),
    stat_virtualization: 'strict',
    host_permissions: 'private',
    follow_root_symlinks: false,
  })
  mounts.push({ type: 'Tmpfs', guest: '/tmp', size_mib: tmpfsSize(vm.memoryMib), options: mountOptions() })
  return {
    name,
    image: { Oci: { reference: spec.image } },
    resources: {
      cpus: vm.cpus,
      memory_mib: vm.memoryMib,
      max_cpus: vm.cpus,
      max_memory_mib: vm.memoryMib,
    },
    runtime: {
      workdir: (vm.projectMounts || [''])[0],
      shell: '/bin/sh',
      scripts: {},
      entrypoint: ['/usr/bin/env'],
      cmd: ['sleep', 'infinity'],
      hostname: null,
      user: spec.execUser,
      log_level: 'info',
      metrics_sample_interval_ms: 1000,
      disable_metrics_sample: false,
    },
    env: [{ key: 'PATH', value: spec.pathEnv }],
    labels: { 'ocm.managed': 'true', 'ocm.net': spec.net, 'ocm.session': vm.rootSessionId },
    rlimits: [],
    mounts,
    patches: [],
    network: {
      enabled: true,
      ports: [],
      policy: spec.policy,
      max_connections: null,
      trust_host_cas: false,
    },
    init: null,
    pull_policy: 'IfMissing',
    security_profile: 'default',
    deployment_profile: 'single_tenant',
    lifecycle: { ephemeral: false, max_duration_secs: null, idle_timeout_secs: null },
    manifest_digest: spec.manifestDigest,
  }
}

const command = args[0]

switch (command) {
  case '--version':
    stdout(spec.version || 'msb 0.6.15')
    break
  case 'inspect': {
    waitGate('inspect')
    const name = args[1] || ''
    const vm = state.vms[name]
    if (!vm) stderrExit('no such sandbox')
    const override = readJson(path.join(stateDir, 'vms', name, 'inspect.json'), null)
    const config = override || synthesize(vm, name)
    stdout(JSON.stringify({
      name,
      status: vm.running ? 'Running' : 'Stopped',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: vm.running ? config : null,
      pending_changes: [],
    }))
    break
  }
  case 'ls':
    fail('ls')
    stdout(JSON.stringify(Object.keys(state.vms).map((name) => ({
      name,
      status: state.vms[name].running ? 'running' : 'stopped',
    }))))
    break
  case 'run': {
    fail('run')
    const name = valueAfter('--name')
    if (!name) stderrExit('missing sandbox name')
    const requiresReplace = readFailure('run-requires-replace')
    if (requiresReplace && !args.includes('--replace')) stderrExit(requiresReplace.stderr, requiresReplace.exitCode)
    const replaceFailure = readFailure('run-replace')
    if (replaceFailure && args.includes('--replace')) stderrExit(replaceFailure.stderr, replaceFailure.exitCode)
    const memory = valueAfter('-m') || '0M'
    const sessionLabel = valuesAfter('--label').find((label) => label.startsWith('ocm.session='))
    clearInspect(name)
    const sharedRoots = new Set(spec.sharedMountRoots || [])
    state.vms[name] = {
      projectMounts: valuesAfter('--mount-dir').map((mount) => mount.split(':')[0]).filter((host) => !sharedRoots.has(host)),
      rootSessionId: sessionLabel ? sessionLabel.slice('ocm.session='.length) : '',
      cpus: Number(valueAfter('-c') || 0),
      memoryMib: Number(memory.replace(/M$/, '')),
      running: true,
    }
    saveState()
    break
  }
  case 'start': {
    fail('start')
    const vm = state.vms[args[1] || '']
    if (!vm) stderrExit('no such sandbox')
    vm.running = true
    saveState()
    break
  }
  case 'stop':
    waitGate('stop')
    fail('stop')
    if (args[1] && state.vms[args[1]]) {
      state.vms[args[1]].running = false
      saveState()
    }
    break
  case 'rm': {
    waitGate('rm')
    fail('rm')
    const name = args[args.length - 1]
    if (name) fail('rm-' + name)
    if (name) clearInspect(name)
    if (name && state.vms[name]) {
      delete state.vms[name]
      saveState()
    }
    break
  }
  case 'volume':
    fail('volume')
    break
  case 'ping':
    fail('ping')
    break
  case 'exec':
    fail('exec')
    break
  case 'pull':
    fail('pull')
    break
  default:
    break
}
`
