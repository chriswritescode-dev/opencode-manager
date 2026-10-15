import path from 'path'
import { ENV } from '@opencode-manager/shared/config/env'
import { isPathWithinRoot, writeFileAtomic } from '../../utils/fs-safe'
import {
  quoteForShell,
  resolveSandboxExecUser,
  sandboxExecutablePath,
  sandboxMountRoots,
  WORKSPACE_SANDBOX_NAME,
} from './command'

export const SANDBOX_SHELL_FILENAME = 'ocm-sandbox-shell'

export const SANDBOX_SHELL_ENV_WORKDIR = 'OCM_SANDBOX_WORKDIR'

/**
 * Space-separated allow-list of variable names the shim forwards from its own
 * environment into the microVM with `msb exec -e`. The plugin pins it from the
 * sandbox plan, so only names the plan approved reach a sandboxed command; the
 * guest environment is otherwise empty.
 */
export const SANDBOX_SHELL_ENV_FORWARD = 'OCM_SANDBOX_FORWARD_ENV'

/**
 * Upper bound on `http.<host>.extraheader` pairs the planner forwards into the
 * microVM. Credentials are configured per host, so this bounds the number of
 * distinct git hosts a sandboxed command can authenticate against.
 */
export const SANDBOX_MAX_FORWARDED_GIT_CONFIGS = 16

/**
 * Drops `http.<host>.extraheader` pairs beyond the forwarding cap, so the
 * guest never sees a `GIT_CONFIG_COUNT` that overstates the pairs actually
 * present. A count larger than the pairs in the environment makes git fail
 * outright.
 */
export function limitForwardedGitConfigs(env: Record<string, string>): {
  env: Record<string, string>
  dropped: number
} {
  const count = Number(env.GIT_CONFIG_COUNT ?? '0')
  if (!Number.isFinite(count) || count <= SANDBOX_MAX_FORWARDED_GIT_CONFIGS) {
    return { env, dropped: 0 }
  }

  const limited: Record<string, string> = { ...env, GIT_CONFIG_COUNT: String(SANDBOX_MAX_FORWARDED_GIT_CONFIGS) }
  for (let index = SANDBOX_MAX_FORWARDED_GIT_CONFIGS; index < count; index++) {
    delete limited[`GIT_CONFIG_KEY_${index}`]
    delete limited[`GIT_CONFIG_VALUE_${index}`]
  }

  return { env: limited, dropped: count - SANDBOX_MAX_FORWARDED_GIT_CONFIGS }
}

export function sandboxShellShimPath(configHome: string): string {
  return path.join(configHome, 'ocm', SANDBOX_SHELL_FILENAME)
}

export function buildSandboxShellShimScript(): string {
  const timeoutSeconds = Math.floor(ENV.SANDBOX.EXEC_TIMEOUT_MS / 1000)
  const execArgs = [
    quoteForShell(sandboxExecutablePath()),
    'exec',
    WORKSPACE_SANDBOX_NAME,
    '--no-tty',
    '-q',
    '-u',
    quoteForShell(resolveSandboxExecUser()),
    '-w',
    `"$${SANDBOX_SHELL_ENV_WORKDIR}"`,
    '--timeout',
    `${timeoutSeconds}s`,
  ].join(' ')
  const forwardEnv = [
    'set -f',
    `for OCM_SHIM_NAME in \${${SANDBOX_SHELL_ENV_FORWARD}}; do`,
    `  case "$OCM_SHIM_NAME" in`,
    `    ''|[0-9]*|*[!A-Za-z0-9_]*|OCM_*|MSB_*) continue ;;`,
    '  esac',
    `  eval "OCM_SHIM_SET=\\\${$OCM_SHIM_NAME+x}"`,
    `  [ -n "$OCM_SHIM_SET" ] || continue`,
    `  eval "OCM_SHIM_VALUE=\\\${$OCM_SHIM_NAME}"`,
    `  set -- "$@" -e "$OCM_SHIM_NAME=$OCM_SHIM_VALUE"`,
    'done',
    'set +f',
  ].join('\n')
  return `#!/bin/sh
if [ -z "\${${SANDBOX_SHELL_ENV_WORKDIR}:-}" ]; then
  echo 'ocm-sandbox-shell: sandbox working directory missing; refusing to run on the host' >&2
  exit 126
fi
OCM_SHIM_ARGC=$#
set -- "$@" ${execArgs}
${forwardEnv}
set -- "$@" -- sh
OCM_SHIM_I=0
while [ "$OCM_SHIM_I" -lt "$OCM_SHIM_ARGC" ]; do
  OCM_SHIM_ARG=$1
  shift
  set -- "$@" "$OCM_SHIM_ARG"
  OCM_SHIM_I=$((OCM_SHIM_I + 1))
done
exec "$@"
`
}

export async function ensureSandboxShellShim(configHome: string): Promise<string> {
  const shimPath = sandboxShellShimPath(configHome)
  const mountRoot = sandboxMountRoots().find((root) => isPathWithinRoot(root, shimPath))
  if (mountRoot !== undefined) {
    throw new Error(
      `refusing to install the sandbox shell shim at ${shimPath}: the path is inside the sandbox mount root ${mountRoot} and would be writable by agent commands`,
    )
  }
  await writeFileAtomic(shimPath, buildSandboxShellShimScript(), { mode: 0o700 })
  return shimPath
}
