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
  const execPrefix = [
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
    '--',
    'sh',
    '"$@"',
  ].join(' ')
  return `#!/bin/sh
if [ -n "\${${SANDBOX_SHELL_ENV_WORKDIR}:-}" ]; then
  exec ${execPrefix}
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
      `refusing to install the sandbox shell shim at ${shimPath}: the path is inside the sandboxed project root ${mountRoot} and would be writable by agent commands`,
    )
  }
  await writeFileAtomic(shimPath, buildSandboxShellShimScript(), { mode: 0o700 })
  return shimPath
}
