import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'

const entrypointPath = join(repoRoot, 'scripts/docker-entrypoint.sh')
const dockerfilePath = join(repoRoot, 'Dockerfile')
const composePath = join(repoRoot, 'docker-compose.yml')
const envExamplePath = join(repoRoot, '.env.example')
const dockerDocsPath = join(repoRoot, 'docs/configuration/docker.md')

const read = (path: string) => readFileSync(path, 'utf-8')

const SOURCE_PATH_RE = /^\s*(?:source|\.)\s+(\/\S+)/m
const COPY_LIB_RE = /^COPY\s+scripts\/lib\/container-user\.sh\s+(\S+)/m

describe('entrypoint library wiring', () => {
  it('sources the path the Dockerfile installs', () => {
    const entrypoint = read(entrypointPath)
    const dockerfile = read(dockerfilePath)

    const sourceMatch = entrypoint.match(SOURCE_PATH_RE)
    const copyMatch = dockerfile.match(COPY_LIB_RE)

    expect(sourceMatch, 'entrypoint must source the container-user library').not.toBeNull()
    expect(copyMatch, 'Dockerfile must COPY the container-user library').not.toBeNull()
    expect(sourceMatch![1]).toBe(copyMatch![1])
  })

  it('aborts explicitly on alignment failure', () => {
    const entrypoint = read(entrypointPath)
    expect(entrypoint).toMatch(/if ! align_container_user node; then/)
    const blockStart = entrypoint.indexOf('align_container_user node; then')
    const blockEnd = entrypoint.indexOf('fi', blockStart)
    const block = entrypoint.slice(blockStart, blockEnd)
    expect(block).toMatch(/exit 1/)
  })

  it('warns before chowning the workspace', () => {
    const entrypoint = read(entrypointPath)
    const warnIndex = entrypoint.indexOf('warn_if_workspace_owner_differs /workspace')
    const workspaceChownMatch = entrypoint.match(/chown -R node:node [^\n]*\/workspace/)
    expect(workspaceChownMatch, 'entrypoint must chown the workspace').not.toBeNull()
    const chownIndex = entrypoint.indexOf(workspaceChownMatch![0])
    expect(warnIndex).toBeGreaterThan(-1)
    expect(chownIndex).toBeGreaterThan(-1)
    expect(warnIndex).toBeLessThan(chownIndex)
  })

  it('grants node access to /dev/kvm before dropping privileges without aborting startup', () => {
    const entrypoint = read(entrypointPath)
    expect(entrypoint).toMatch(/^grant_kvm_access\(\) \{/m)
    const alignIndex = entrypoint.indexOf('if ! align_container_user node; then')
    const grantCallIndex = entrypoint.indexOf('if ! grant_kvm_access; then')
    const runuserIndex = entrypoint.indexOf('exec runuser -u node')
    expect(alignIndex, 'entrypoint must align the container user').toBeGreaterThan(-1)
    expect(grantCallIndex, 'entrypoint must call grant_kvm_access').toBeGreaterThan(-1)
    expect(grantCallIndex).toBeGreaterThan(alignIndex)
    expect(runuserIndex).toBeGreaterThan(grantCallIndex)
    const grantBlock = entrypoint.slice(grantCallIndex, grantCallIndex + 200)
    expect(grantBlock).toMatch(/WARNING: continuing without \/dev\/kvm access/)
    expect(grantBlock.slice(0, grantBlock.indexOf('fi'))).not.toMatch(/exit 1/)
  })

  it('does not re-chown /app when ids change', () => {
    const entrypoint = read(entrypointPath)

    expect(entrypoint).not.toContain('OCM_UID_CHANGED')
    expect(entrypoint).not.toContain('OCM_GID_CHANGED')
    expect(entrypoint).not.toMatch(/chown -R node:node \/app(?:\s|\n|$)/)

    expect(entrypoint).toContain('chown -R node:node /app/data /workspace /home/node')
    expect(entrypoint).toContain('mkdir -p /app/data /workspace /home/node/.cache /home/node/.opencode')
  })

  it('does not mark the library executable in the image', () => {
    const dockerfile = read(dockerfilePath)
    expect(dockerfile).not.toMatch(/chmod \+x \/usr\/local\/lib\/ocm\/container-user\.sh/)
  })
})

describe('microsandbox runtime install', () => {
  const dockerfile = read(dockerfilePath)

  it('declares MICROSANDBOX_VERSION next to the other tool args', () => {
    expect(dockerfile).toMatch(/ARG MICROSANDBOX_VERSION=0\.6\.15/)
  })

  it('resolves the release URL from MICROSANDBOX_VERSION, not only the log message', () => {
    const microsandboxRun = dockerfile.slice(dockerfile.indexOf('Installing microsandbox='), dockerfile.indexOf('msb --version'))
    expect(microsandboxRun).toMatch(/releases\/download\/\$\{MSB_VERSION\}/)
    expect(microsandboxRun).toMatch(/MSB_VERSION="v\$\{MICROSANDBOX_VERSION\}"/)
  })

  it('pins a tested version and avoids unauthenticated GitHub API lookups', () => {
    const microsandboxRun = dockerfile.slice(dockerfile.indexOf('Installing microsandbox='), dockerfile.indexOf('msb --version'))
    expect(microsandboxRun).not.toMatch(/releases\/latest\/download/)
    expect(microsandboxRun).not.toContain('install.microsandbox.dev')
    expect(microsandboxRun).not.toMatch(/api\.github\.com/)
  })

  it('passes the same MICROSANDBOX_VERSION from the docker-build workflow', () => {
    const workflow = read(join(repoRoot, '.github/workflows/docker-build.yml'))
    expect(workflow).toContain('MICROSANDBOX_VERSION=0.6.15')
    expect(workflow).toContain('MICROSANDBOX_VERSION=${{ steps.versions.outputs.microsandbox }}')
  })

  it('downloads the arch-specific bundle and verifies its checksum', () => {
    const microsandboxRun = dockerfile.slice(dockerfile.indexOf('Installing microsandbox='), dockerfile.indexOf('msb --version'))
    expect(microsandboxRun).toMatch(/MSB_BUNDLE="microsandbox-linux-\$\{MSB_TARGET\}\.tar\.gz"/)
    expect(microsandboxRun).toMatch(/MSB_TARGET="x86_64"/)
    expect(microsandboxRun).toMatch(/MSB_TARGET="aarch64"/)
    expect(microsandboxRun).toMatch(/checksums\.sha256/)
    expect(microsandboxRun).toMatch(/sha256sum -c --quiet/)
  })

  it('installs msb and libkrunfw under /opt/microsandbox with the runtime symlinks', () => {
    expect(dockerfile).toContain('/opt/microsandbox/bin/msb')
    expect(dockerfile).toContain('/usr/local/bin/msb')
    expect(dockerfile).toContain('/opt/microsandbox/lib/libkrunfw.so')
    expect(dockerfile).toMatch(/chmod -R a\+rX \/opt\/microsandbox/)
    expect(dockerfile).toMatch(/msb --version/)
  })

  it('keeps the state directory writable by the node user', () => {
    expect(dockerfile).toMatch(/mkdir -p \/workspace \/app\/data \/home\/node\/\.cache \/home\/node\/\.opencode \/home\/node\/\.microsandbox/)
    expect(dockerfile).toMatch(/chown -R node:node \/workspace \/app\/data \/home\/node/)
  })
})

describe('workspace ownership configuration', () => {
  it('exposes PUID and PGID environment defaults in docker-compose.yml', () => {
    const compose = read(composePath)
    expect(compose).toContain('- PUID=${PUID:-1000}')
    expect(compose).toContain('- PGID=${PGID:-1000}')
  })

  it('overrides the workspace mount source in docker-compose.yml', () => {
    const compose = read(composePath)
    expect(compose).toContain('${OCM_WORKSPACE_HOST_PATH:-opencode-workspace}:/workspace')
  })

  it('does not declare the bare service workspace mount in docker-compose.yml', () => {
    const compose = read(composePath)
    expect(compose).not.toContain('- opencode-workspace:/workspace')
  })

  it('keeps the opencode-workspace named volume declared at top level', () => {
    const compose = read(composePath)
    expect(compose).toMatch(/^volumes:\n(?:.*\n)*?\s+opencode-workspace:/m)
  })

  it('mounts a dedicated named volume at /home/node/.opencode/bin with a top-level declaration', () => {
    const compose = read(composePath)
    expect(compose).toContain('opencode-bin:/home/node/.opencode/bin')
    expect(compose).toMatch(/^volumes:\n(?:.*\n)*?\s+opencode-bin:/m)
  })

  it('persists only the opencode bin directory, not the whole ~/.opencode home', () => {
    const compose = read(composePath)
    expect(compose).not.toMatch(/:\/home\/node\/\.opencode(?:\s|$)/)
  })

  it('lists the opencode-bin volume in the installation docs table', () => {
    const docs = read(join(repoRoot, 'docs/getting-started/installation.md'))
    expect(docs).toContain('| `opencode-bin` | `/home/node/.opencode/bin` |')
  })

  it('keeps the docker docs compose snippet in sync with docker-compose.yml', () => {
    const compose = read(composePath)
    const docs = read(dockerDocsPath)

    const fenceStart = docs.indexOf('```yaml\nservices:')
    expect(fenceStart, 'docs must contain a fenced compose yaml block').toBeGreaterThan(-1)
    const contentStart = fenceStart + '```yaml\n'.length
    const fenceEnd = docs.indexOf('\n```\n', contentStart)
    expect(fenceEnd, 'docs compose yaml block must be closed').toBeGreaterThan(-1)
    const docsBlock = docs.slice(contentStart, fenceEnd)

    const normalize = (s: string) => s.replace(/\s+$/, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    expect(normalize(docsBlock)).toBe(normalize(compose))
  })

  it('documents the Accessing Repositories From the Host subsection', () => {
    const docs = read(dockerDocsPath)
    expect(docs).toContain('#### Accessing Repositories From the Host')
  })

  it('documents the new workspace ownership env vars in .env.example', () => {
    const envExample = read(envExamplePath)
    expect(envExample).toContain('OCM_WORKSPACE_HOST_PATH')
    expect(envExample).toContain('# PUID=1000')
    expect(envExample).toContain('# PGID=1000')
  })

  it('documents the migration empty-destination guard and quoted host path', () => {
    const docs = read(dockerDocsPath)
    expect(docs).toContain('if [ -n "$(ls -A "<host path>")" ]; then')
    expect(docs).toContain('mkdir -p "<host path>"')
    expect(docs).toContain('-v "<host path>":/to')
    expect(docs).toContain('chown -R "$(id -u):$(id -g)" "<host path>"')
  })
})

describe('docker lifecycle scripts', () => {
  it('keeps docker:down non-destructive and docker:reset destructive', () => {
    const pkg = read(join(repoRoot, 'package.json'))
    expect(pkg).toContain('"docker:down": "docker-compose down"')
    expect(pkg).toContain('"docker:reset": "docker-compose down -v"')
  })

  it('documents the preserved-volume shutdown and the destructive reset', () => {
    const docs = read(dockerDocsPath)
    expect(docs).toContain('named volumes are preserved')
    expect(docs).toContain('docker-compose down -v')
  })

  it('documents a targeted opencode-bin volume reset that preserves the other volumes', () => {
    const docs = read(join(repoRoot, 'docs/troubleshooting.md'))
    expect(docs).toContain('docker volume rm <project>_opencode-bin')
    expect(docs).toContain('without touching the workspace or database volumes')
  })
})

describe('sandbox guest image', () => {
  const sandboxDockerfilePath = join(repoRoot, 'Dockerfile.sandbox')
  const sandboxDockerfile = read(sandboxDockerfilePath)

  it('pins the pnpm store to a container-internal path via PNPM_CONFIG_STORE_DIR', () => {
    expect(sandboxDockerfile).toContain('PNPM_CONFIG_STORE_DIR=/home/ocm-agent/.local/share/pnpm/store')
    expect(sandboxDockerfile, 'pnpm 11 ignores npm_config_* env vars').not.toContain('npm_config_store_dir=')
  })
})

describe('sandbox compose overlay', () => {
  const overlayPath = join(repoRoot, 'docker-compose.sandbox.yml')
  const overlay = read(overlayPath)
  const overlayDirectives = overlay
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

  it('defaults SANDBOX_EXEC_USER from PUID so the guest identity tracks the workspace owner', () => {
    expect(overlay).toContain('- SANDBOX_EXEC_USER=${SANDBOX_EXEC_USER:-${PUID:-1000}}')
  })

  it('keeps the base compose free of KVM and privileged flags', () => {
    const compose = read(composePath)
    expect(compose).not.toContain('privileged')
    expect(compose).not.toContain('/dev/kvm')
  })

  it('grants KVM and persists microsandbox state only in the overlay', () => {
    expect(overlay).toContain('"/dev/kvm:/dev/kvm"')
    expect(overlay).toContain('"/dev/net/tun:/dev/net/tun"')
    expect(overlay).toContain('- NET_ADMIN')
    expect(overlay).toContain('microsandbox-data:/home/node/.microsandbox')
    expect(overlay).toMatch(/^volumes:\n(?:.*\n)*?\s+microsandbox-data:/m)
  })

  it('grants only the devices and capability msb needs, never full container privilege', () => {
    expect(overlayDirectives.join('\n')).not.toContain('privileged')
  })

  it('keeps the sandbox overlay docs snippet in sync with docker-compose.sandbox.yml', () => {
    const docs = read(dockerDocsPath)
    const docsOverlay = [...docs.matchAll(/```yaml\n([\s\S]*?)\n```/g)]
      .map((match) => match[1]!)
      .find((block) => block.includes('microsandbox-data'))

    expect(docsOverlay, 'docs must contain the sandbox overlay yaml block').toBeDefined()

    const significantLines = (source: string[]) =>
      source.filter((line) => line.trim() !== '').map((line) => line.replace(/\s+$/, '')).join('\n')

    expect(significantLines(docsOverlay!.split('\n'))).toBe(significantLines(overlayDirectives))
  })
})

describe('named-volume migration recipe', () => {
  const runMigrationShell = (src: string, dst: string) => {
    const scriptDir = mkdtempSync(join(tmpdir(), 'migrate-script-'))
    const scriptPath = join(scriptDir, 'migrate.sh')
    writeFileSync(
      scriptPath,
      `set -eu
src=${JSON.stringify(src)}
dst=${JSON.stringify(dst)}
mkdir -p "$dst"
if [ -n "$(ls -A "$dst")" ]; then
  echo "destination '$dst' is not empty; aborting migration" >&2
  exit 1
fi
cp -a "$src/." "$dst/"
chown -R "$(id -u):$(id -g)" "$dst"
`,
    )
    try {
      return execSync(`bash ${JSON.stringify(scriptPath)}`, { stdio: 'pipe' })
    } finally {
      rmSync(scriptDir, { recursive: true, force: true })
    }
  }

  it('aborts without modification when the destination is non-empty', () => {
    const dst = mkdtempSync(join(tmpdir(), 'migrate-dst-'))
    writeFileSync(join(dst, 'existing.txt'), 'keep me')
    const src = mkdtempSync(join(tmpdir(), 'migrate-src-'))
    mkdirSync(join(src, 'repo'))
    writeFileSync(join(src, 'repo', 'file.txt'), 'volume data')

    let threw = false
    try {
      runMigrationShell(src, dst)
    } catch {
      threw = true
    }

    expect(threw, 'recipe must abort when destination is non-empty').toBe(true)
    expect(readdirSync(dst)).toEqual(['existing.txt'])
    expect(existsSync(join(dst, 'repo'))).toBe(false)
    rmSync(dst, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })

  it('copies volume contents to the root of an empty destination with spaces in the path', () => {
    const root = mkdtempSync(join(tmpdir(), 'migrate-root-'))
    const dst = join(root, 'My Repositories')
    const src = mkdtempSync(join(tmpdir(), 'migrate-src-'))
    mkdirSync(join(src, 'repo'))
    writeFileSync(join(src, 'repo', 'file.txt'), 'volume data')

    runMigrationShell(src, dst)

    expect(statSync(join(dst, 'repo', 'file.txt')).isFile()).toBe(true)
    expect(readdirSync(dst)).toEqual(['repo'])
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })
})
