export const SANDBOX_SHELL_STATE_KEY = 'ocm-sandbox.shell-state.v3'

export const SANDBOX_SHELL_MARKER_PREFIX = 'ocm-sandbox-required-'

export const SECRET_MASK_STORE_SOURCE = `var MASK_STATE_KEY = Symbol.for('ocm-secret-masks.v1')

function maskState() {
  var state = globalThis[MASK_STATE_KEY]
  if (state === undefined) {
    state = { byCwd: new Map(), version: 0, unionVersion: -1, union: [] }
    globalThis[MASK_STATE_KEY] = state
  }
  return state
}

function replaceMaskValues(cwd, values) {
  var state = maskState()
  var seen = new Set()
  var sorted = []
  if (Array.isArray(values)) {
    for (var index = 0; index < values.length; index += 1) {
      var value = values[index]
      if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue
      seen.add(value)
      sorted.push(value)
    }
  }
  sorted.sort(function (a, b) { return b.length - a.length })
  if (sorted.length === 0) state.byCwd.delete(cwd || '')
  else state.byCwd.set(cwd || '', sorted)
  state.version += 1
}

function currentMaskValues(cwd) {
  return maskState().byCwd.get(cwd || '') || null
}

function allCurrentMaskValues() {
  var state = maskState()
  if (state.unionVersion === state.version) return state.union
  var seen = new Set()
  var union = []
  for (var list of state.byCwd.values()) {
    for (var index = 0; index < list.length; index += 1) {
      if (seen.has(list[index])) continue
      seen.add(list[index])
      union.push(list[index])
    }
  }
  union.sort(function (a, b) { return b.length - a.length })
  state.unionVersion = state.version
  state.union = union
  return union
}`
