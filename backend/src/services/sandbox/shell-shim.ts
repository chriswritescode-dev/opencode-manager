import path from 'path'
import { existsSync } from 'fs'
import { ENV } from '@opencode-manager/shared/config/env'
import { writeFileAtomic } from '../../utils/fs-safe'
import {
  isPathWithinRoot,
  quoteForShell,
  resolveSandboxExecUser,
  sandboxExecutablePath,
  sandboxMountRoots,
  WORKSPACE_SANDBOX_NAME,
} from './command'

export const SANDBOX_SHELL_FILENAME = 'ocm-sandbox-shell'

export const SANDBOX_SHELL_ENV_WORKDIR = 'OCM_SANDBOX_WORKDIR'

export const SANDBOX_SHELL_ENV_HOST_SHELL = 'OCM_SANDBOX_HOST_SHELL'

/**
 * Upper bound on `http.<host>.extraheader` pairs forwarded into the microVM.
 * The shim enumerates a fixed set of variable names rather than expanding
 * `GIT_CONFIG_KEY_$i` indirectly, which would require `eval` on values holding
 * credentials. Credentials are configured per host, so this bounds the number
 * of distinct git hosts a sandboxed command can authenticate against.
 */
export const SANDBOX_MAX_FORWARDED_GIT_CONFIGS = 16

/**
 * Variables the shim copies from its own environment into the microVM with
 * `msb exec -e`. The guest environment is otherwise empty, so anything absent
 * from this list never reaches a sandboxed command.
 */
export const SANDBOX_FORWARDED_ENV_NAMES: readonly string[] = [
  'GIT_TERMINAL_PROMPT',
  'GIT_CONFIG_COUNT',
  ...Array.from({ length: SANDBOX_MAX_FORWARDED_GIT_CONFIGS }, (_, index) => [
    `GIT_CONFIG_KEY_${index}`,
    `GIT_CONFIG_VALUE_${index}`,
  ]).flat(),
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GH_TOKEN',
  'GITHUB_TOKEN',
]

/**
 * Drops `http.<host>.extraheader` pairs the shim cannot forward, so the guest
 * never sees a `GIT_CONFIG_COUNT` that overstates the pairs actually present.
 * A count larger than the pairs in the environment makes git fail outright.
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

export function resolveShimHostShell(): string {
  const configured = process.env.SHELL?.trim()
  if (
    configured !== undefined &&
    configured !== '' &&
    path.isAbsolute(configured) &&
    path.basename(configured) !== SANDBOX_SHELL_FILENAME &&
    existsSync(configured)
  ) {
    return configured
  }
  if (existsSync('/bin/bash')) return '/bin/bash'
  return '/bin/sh'
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
  const forwardEnv = SANDBOX_FORWARDED_ENV_NAMES.map(
    (name) => `  if [ -n "\${${name}+x}" ]; then set -- "$@" -e "${name}=$${name}"; fi`,
  ).join('\n')
  return `#!/bin/sh
if [ -n "\${${SANDBOX_SHELL_ENV_WORKDIR}:-}" ]; then
  ocm_argc=$#
  set -- "$@" ${execArgs}
${forwardEnv}
  set -- "$@" -- sh
  ocm_i=0
  while [ "$ocm_i" -lt "$ocm_argc" ]; do
    ocm_arg=$1
    shift
    set -- "$@" "$ocm_arg"
    ocm_i=$((ocm_i + 1))
  done
  exec "$@"
fi
OCM_SANDBOX_DEFAULT_SHELL=${quoteForShell(resolveShimHostShell())}
exec "\${${SANDBOX_SHELL_ENV_HOST_SHELL}:-$OCM_SANDBOX_DEFAULT_SHELL}" "$@"
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
