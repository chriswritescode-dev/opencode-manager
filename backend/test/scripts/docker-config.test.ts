import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, existsSync, chmodSync } from 'fs'
import { execFileSync, execSync, spawnSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'

const entrypointPath = join(repoRoot, 'scripts/docker-entrypoint.sh')
const dockerfilePath = join(repoRoot, 'Dockerfile')
const composePath = join(repoRoot, 'docker-compose.yml')
const envExamplePath = join(repoRoot, '.env.example')

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

  it('runs the entrypoint under tini so orphaned processes are reaped', () => {
    const dockerfile = read(dockerfilePath)
    expect(dockerfile).toMatch(/^\s+tini \\$/m)
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]')
    expect(read(composePath)).not.toContain('init: true')
  })
})

describe('microsandbox runtime install', () => {
  const dockerfile = read(dockerfilePath)

  it('declares MICROSANDBOX_VERSION next to the other tool args', () => {
    expect(dockerfile).toMatch(/ARG MICROSANDBOX_VERSION=0\.7\.2/)
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
    expect(workflow).toContain('MICROSANDBOX_VERSION=0.7.2')
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

describe('uv install pin', () => {
  const dockerfile = read(dockerfilePath)
  const sandboxDockerfile = read(join(repoRoot, 'Dockerfile.sandbox'))
  const workflow = read(join(repoRoot, '.github/workflows/docker-build.yml'))
  const uvRun = dockerfile.slice(dockerfile.indexOf('Installing uv='), dockerfile.indexOf('Downloading opencode'))

  it('installs uv from the versioned installer URL', () => {
    expect(uvRun).toMatch(/https:\/\/astral\.sh\/uv\/\$\{UV_VERSION\}\/install\.sh/)
    expect(uvRun).not.toMatch(/https:\/\/astral\.sh\/uv\/install\.sh/)
  })

  it('verifies the installed uv version matches the build argument', () => {
    expect(uvRun).toContain('test "$(uv --version | cut -d\' \' -f2)" = "${UV_VERSION}"')
  })

  it('pins the workflow to the verified-good release instead of resolving the latest tag', () => {
    expect(workflow).toContain('UV_VERSION=0.12.7')
    expect(workflow).not.toContain('astral-sh/uv.git')
  })

  it('pins the same UV_VERSION in the sandbox guest image', () => {
    expect(sandboxDockerfile).toMatch(/ARG UV_VERSION=0\.12\.7/)
    expect(sandboxDockerfile).toContain('test "$(uv --version | cut -d\' \' -f2)" = "${UV_VERSION}"')
  })
})

describe('chromium runtime libraries for playwright', () => {
  const dockerfile = read(dockerfilePath)
  const sandboxDockerfile = read(join(repoRoot, 'Dockerfile.sandbox'))
  const workflow = read(join(repoRoot, '.github/workflows/docker-build.yml'))
  const installRun = dockerfile.slice(
    dockerfile.indexOf('Installing playwright='),
    dockerfile.indexOf('COPY --from=deps --chown=node:node /app/node_modules'),
  )

  it('declares PLAYWRIGHT_VERSION next to the other tool args', () => {
    expect(dockerfile).toMatch(/ARG PLAYWRIGHT_VERSION=1\.63\.0/)
  })

  it('installs the pinned playwright and verifies its version', () => {
    expect(installRun).toContain('npm install -g "playwright@${PLAYWRIGHT_VERSION}"')
    expect(installRun).toContain('test "$(playwright --version | awk \'{print $2}\')" = "${PLAYWRIGHT_VERSION}"')
  })

  it('preinstalls chromium with its system dependencies into a shared browsers path', () => {
    expect(dockerfile).toContain('ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright')
    expect(installRun).toContain('playwright install --with-deps chromium')
    expect(installRun).toContain('chown -R node:node "${PLAYWRIGHT_BROWSERS_PATH}"')
  })

  it('does not hand-maintain a package list', () => {
    expect(installRun).not.toMatch(/libasound2t64|libnss3|libgbm1/)
    expect(installRun).not.toContain('apt-get install')
  })

  it('cleans the apt lists and npm cache in the same layer', () => {
    expect(installRun).toContain('rm -rf /var/lib/apt/lists/* /root/.npm')
  })

  it('pins the same PLAYWRIGHT_VERSION in the sandbox guest image', () => {
    expect(sandboxDockerfile).toMatch(/ARG PLAYWRIGHT_VERSION=1\.63\.0/)
  })

  it('passes the same PLAYWRIGHT_VERSION from the docker-build workflow', () => {
    expect(workflow).toContain('PLAYWRIGHT_VERSION=1.63.0')
    expect(workflow).toContain('PLAYWRIGHT_VERSION=${{ steps.versions.outputs.playwright }}')
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

  it('documents the new workspace ownership env vars in .env.example', () => {
    const envExample = read(envExamplePath)
    expect(envExample).toContain('OCM_WORKSPACE_HOST_PATH')
    expect(envExample).toContain('# PUID=1000')
    expect(envExample).toContain('# PGID=1000')
  })
})

describe('compose image source', () => {
  const RELEASE_IMAGE_LINE = '    image: ghcr.io/chriswritescode-dev/opencode-manager:latest\n'
  const BUILD_BLOCK_RE = /^ {4}build:\n(?: {6}.*\n)+/m
  const withoutComments = (source: string) => source.replace(/^#.*\n/gm, '').replace(/^\n+/, '')

  it('builds docker-compose.yml from the checkout so git pull and rebuild keep working', () => {
    const compose = read(composePath)
    expect(compose).toMatch(/^ {4}build:\n {6}context: \.\n {6}dockerfile: Dockerfile\n/m)
    expect(compose).not.toMatch(/^ {4}image:/m)
  })

  it('keeps docker-compose.release.yml identical to docker-compose.yml apart from its project name and pulling the published image', () => {
    const compose = read(composePath)
    const release = withoutComments(read(join(repoRoot, 'docker-compose.release.yml')))
    const workflow = read(join(repoRoot, '.github/workflows/docker-build.yml'))
    expect(workflow).toContain('images: ghcr.io/${{ github.repository }}')
    expect(release).not.toMatch(/^ {4}build:/m)
    expect(release).toBe(`name: ocm\n\n${compose.replace(BUILD_BLOCK_RE, RELEASE_IMAGE_LINE)}`)
  })

  it('lets the entrypoint generate AUTH_SECRET when .env does not set one', () => {
    expect(read(composePath)).toContain('- AUTH_SECRET=${AUTH_SECRET:-}')
    expect(read(envExamplePath)).not.toMatch(/^AUTH_SECRET=/m)
  })
})

describe('docker lifecycle scripts', () => {
  it('keeps docker:down non-destructive and docker:reset destructive', () => {
    const pkg = read(join(repoRoot, 'package.json'))
    expect(pkg).toContain('"docker:down": "docker-compose down"')
    expect(pkg).toContain('"docker:reset": "docker-compose down -v"')
  })
})

describe('sandbox guest image', () => {
  const sandboxDockerfilePath = join(repoRoot, 'Dockerfile.sandbox')
  const sandboxDockerfile = read(sandboxDockerfilePath)

  it('pins the pnpm store to a container-internal path via PNPM_CONFIG_STORE_DIR', () => {
    expect(sandboxDockerfile).toContain('PNPM_CONFIG_STORE_DIR=/home/ocm-agent/.local/share/pnpm/store')
    expect(sandboxDockerfile, 'pnpm 11 ignores npm_config_* env vars').not.toContain('npm_config_store_dir=')
  })

  it('builds from the same pinned base tag as the Manager image', () => {
    const managerBase = read(dockerfilePath).match(/^FROM (node:\S+) AS base$/m)?.[1]
    expect(managerBase).toMatch(/^node:\d+\.\d+\.\d+-trixie$/)
    expect(sandboxDockerfile).toMatch(new RegExp(`^FROM ${managerBase!.replace(/\./g, '\\.')}$`, 'm'))
  })

  it('installs pnpm through npm at a pinned version and asserts it, without corepack', () => {
    expect(sandboxDockerfile).toMatch(/ARG PNPM_VERSION=11\.24\.0/)
    expect(sandboxDockerfile).toContain('npm install -g "pnpm@${PNPM_VERSION}"')
    expect(sandboxDockerfile).toContain('test "$(pnpm --version)" = "${PNPM_VERSION}"')
    expect(sandboxDockerfile).not.toContain('corepack')
  })

  it('pins bun through the installer tag and asserts the installed version', () => {
    expect(sandboxDockerfile).toMatch(/ARG BUN_VERSION=1\.4\.2/)
    expect(sandboxDockerfile).toContain('bash -s "bun-v${BUN_VERSION}"')
    expect(sandboxDockerfile).toContain('test "$(bun --version)" = "${BUN_VERSION}"')
  })

  it('pins fallow, rust and go and asserts each installed version', () => {
    expect(sandboxDockerfile).toMatch(/ARG FALLOW_VERSION=3\.27\.0/)
    expect(sandboxDockerfile).toContain('"fallow@${FALLOW_VERSION}"')
    expect(sandboxDockerfile).toContain('fallow --version | grep -x "fallow ${FALLOW_VERSION}" >/dev/null')
    expect(sandboxDockerfile).toMatch(/ARG RUST_VERSION=1\.98\.1/)
    expect(sandboxDockerfile).toContain('--profile minimal --default-toolchain "${RUST_VERSION}"')
    expect(sandboxDockerfile).toContain('test "$(rustc --version | cut -d\' \' -f2)" = "${RUST_VERSION}"')
    expect(sandboxDockerfile).toMatch(/ARG GO_VERSION=1\.27\.1/)
    expect(sandboxDockerfile).toContain('test "$(go version | cut -d\' \' -f3)" = "go${GO_VERSION}"')
  })

  it('opens the rust homes to every uid and routes go installs onto the agent tools PATH', () => {
    expect(sandboxDockerfile).toContain('ENV RUSTUP_HOME=/usr/local/rustup')
    expect(sandboxDockerfile).toContain('ENV CARGO_HOME=/usr/local/cargo')
    expect(sandboxDockerfile).toContain('chmod -R a+w "${RUSTUP_HOME}" "${CARGO_HOME}"')
    expect(sandboxDockerfile).toContain('ENV GOBIN=/opt/agent-tools/bin')
    expect(sandboxDockerfile).toContain('ENV PNPM_HOME=/opt/agent-tools')
    expect(sandboxDockerfile).toMatch(/ENV PATH=\/opt\/agent-tools:\/opt\/agent-tools\/bin:\/usr\/local\/cargo\/bin:\/usr\/local\/go\/bin:\$PATH/)
  })

  it('declares npm_config_prefix only after every root-run npm install -g', () => {
    const prefixIndex = sandboxDockerfile.indexOf('ENV npm_config_prefix=')
    expect(prefixIndex).toBeGreaterThan(-1)
    expect(sandboxDockerfile.lastIndexOf('npm install -g "')).toBeLessThan(prefixIndex)
  })

  it('verifies the rust and go toolchains as the unknown uid', () => {
    const verifyRun = sandboxDockerfile.slice(sandboxDockerfile.indexOf('Verifying guest toolchain'))
    expect(verifyRun).toMatch(/setpriv --reuid=4242 [^\n]*fallow --version/)
    expect(verifyRun).toMatch(/setpriv --reuid=4242 [^\n]*cargo build/)
    expect(verifyRun).toMatch(/setpriv --reuid=4242 [^\n]*go run \./)
  })

  it('runs each verification step under bash errexit and pipefail without head pipelines', () => {
    const verifyRun = sandboxDockerfile.slice(sandboxDockerfile.indexOf('Verifying guest toolchain'))
    expect(verifyRun).not.toContain('sh -c "set -e;')
    expect(verifyRun).not.toContain('| head')
    const scripts = [...verifyRun.matchAll(/bash -euo pipefail -c '([^']*)'/g)].map((match) => match[1]!)
    expect(scripts).toHaveLength(3)
  })

  it('aborts the verification script when an injected cargo build fails', () => {
    const verifyRun = sandboxDockerfile.slice(sandboxDockerfile.indexOf('Verifying guest toolchain'))
    const rustGoScript = [...verifyRun.matchAll(/bash -euo pipefail -c '([^']*)'/g)]
      .map((match) => match[1]!)
      .find((script) => script.includes('cargo build'))
    expect(rustGoScript, 'rust/go verification script must be extractable').toBeDefined()

    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-verify-'))
    const binDir = join(workDir, 'bin')
    mkdirSync(binDir)

    const writeStub = (name: string, lines: string[]) => {
      const stubPath = join(binDir, name)
      writeFileSync(stubPath, ['#!/usr/bin/env bash', 'set -euo pipefail', ...lines, ''].join('\n'))
      chmodSync(stubPath, 0o755)
    }

    writeStub('cargo', [
      'crate_dir=""',
      'for arg in "$@"; do crate_dir="$arg"; done',
      'case "$1" in',
      '  new) mkdir -p "$crate_dir/target/debug"; printf "%s\\n" "$crate_dir" > "$STUB_STATE/crate-dir" ;;',
      '  build)',
      '    dir="$(cat "$STUB_STATE/crate-dir")"',
      '    printf "#!/usr/bin/env bash\\necho \\"Hello, world!\\"\\n" > "$dir/target/debug/rs-check"',
      '    chmod +x "$dir/target/debug/rs-check"',
      '    exit 1 ;;',
      'esac',
    ])

    writeStub('go', [
      'case "$1" in',
      '  mod) exit 0 ;;',
      '  run) echo go-ok ;;',
      'esac',
    ])

    let status = 0
    try {
      execFileSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', rustGoScript!], {
        cwd: workDir,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, TMPDIR: workDir, HOME: workDir, STUB_STATE: binDir },
        stdio: 'pipe',
      })
    } catch (error) {
      status = (error as { status?: number }).status ?? 1
    }

    expect(status, 'a failed cargo build must abort the verification script').not.toBe(0)
    expect(existsSync(join(binDir, 'crate-dir'))).toBe(true)
    rmSync(workDir, { recursive: true, force: true })
  })
})

describe('sandbox image workflow', () => {
  const workflow = read(join(repoRoot, '.github/workflows/sandbox-image.yml'))

  it('builds each platform on a native runner instead of under qemu', () => {
    expect(workflow).toMatch(/platform: linux\/amd64\n\s+runner: ubuntu-latest/)
    expect(workflow).toMatch(/platform: linux\/arm64\n\s+runner: ubuntu-24\.04-arm/)
    expect(workflow).not.toContain('setup-qemu-action')
  })

  it('pushes per-platform digests and merges them into one manifest list', () => {
    expect(workflow).toContain('push-by-digest=true,name-canonical=true,push=true')
    expect(workflow).toContain('docker buildx imagetools create')
    expect(workflow).toContain('file: Dockerfile.sandbox')
  })

  it('publishes the digest-pinned default image repository', () => {
    expect(workflow).toContain('IMAGE: docker.io/cstechdev/ocm-sandbox')
  })

  it('only pushes from this repository, never from fork pull requests', () => {
    expect(workflow).toContain("github.event.pull_request.head.repo.full_name == github.repository")
  })

  it('validates pull requests without registry credentials or publishing', () => {
    expect(workflow).toMatch(/- name: Login to Docker Hub\n\s+if: github.event_name == 'workflow_dispatch'/)
    expect(workflow).toContain("|| 'type=cacheonly'")
    expect(workflow).toMatch(/- name: Export digest\n\s+if: github.event_name == 'workflow_dispatch'/)
    expect(workflow).toMatch(/- name: Upload digest\n\s+if: github.event_name == 'workflow_dispatch'/)
    expect(workflow).toMatch(/merge:\n\s+if: github.event_name == 'workflow_dispatch'/)
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

describe('sandbox dockerd startup helper', () => {
  const sandboxDockerfilePath = join(repoRoot, 'Dockerfile.sandbox')
  const sandboxDockerdPath = join(repoRoot, 'scripts/sandbox-dockerd-start.sh')
  const sandboxWorkflowPath = join(repoRoot, '.github/workflows/sandbox-image.yml')

  const runSandboxDockerd = (options: { dockerExit?: number; env?: Record<string, string> } = {}) => {
    const stubDir = mkdtempSync(join(tmpdir(), 'ocm-dockerd-'))
    const logPath = join(stubDir, 'calls.log')
    try {
      const writeStub = (name: string, body: string) => {
        const file = join(stubDir, name)
        writeFileSync(file, `#!/bin/bash\n${body}\n`)
        chmodSync(file, 0o755)
      }

      writeStub('timeout', 'shift\nexec "$@"')
      writeStub(
        'docker',
        [
          'echo "docker $*" >> "$OCM_STUB_LOG"',
          'echo "DOCKER_HOST=${DOCKER_HOST:-<unset>}" >> "$OCM_STUB_LOG"',
          'echo "DOCKER_CONTEXT=${DOCKER_CONTEXT:-<unset>}" >> "$OCM_STUB_LOG"',
          'exit "${OCM_STUB_DOCKER_EXIT:-0}"',
        ].join('\n'),
      )
      writeStub('id', 'case "$1" in\n  -u) echo "${OCM_STUB_CALLER_UID:-1000}" ;;\n  *) echo 0 ;;\nesac')
      writeStub('sudo', 'echo "sudo $*" >> "$OCM_STUB_LOG"\nexit 0')
      writeStub('setsid', 'echo "setsid $*" >> "$OCM_STUB_LOG"\nexit 0')

      const result = spawnSync('sh', [sandboxDockerdPath], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          OCM_STUB_LOG: logPath,
          OCM_STUB_DOCKER_EXIT: String(options.dockerExit ?? 0),
          ...options.env,
        },
      })

      const calls = existsSync(logPath) ? readFileSync(logPath, 'utf-8').split('\n').filter(Boolean) : []
      return { result, calls }
    } finally {
      rmSync(stubDir, { recursive: true, force: true })
    }
  }

  it('exits successfully against a ready guest daemon without sudo or setsid', () => {
    const { result, calls } = runSandboxDockerd()

    expect(result.status).toBe(0)
    expect(calls.some((call) => call.startsWith('sudo '))).toBe(false)
    expect(calls.some((call) => call.startsWith('setsid '))).toBe(false)
  })

  it('probes with the explicit socket after stripping ambient DOCKER_HOST and DOCKER_CONTEXT', () => {
    const { result, calls } = runSandboxDockerd({
      env: { DOCKER_HOST: 'tcp://ambient:2375', DOCKER_CONTEXT: 'ambient-context' },
    })

    expect(result.status).toBe(0)
    expect(calls).toContain('docker -H unix:///var/run/docker.sock info')
    expect(calls).toContain('DOCKER_HOST=<unset>')
    expect(calls).toContain('DOCKER_CONTEXT=<unset>')
  })

  it('reexecutes itself through sudo -n when a non-root caller cannot reach the daemon', () => {
    const { result, calls } = runSandboxDockerd({
      dockerExit: 1,
      env: { OCM_STUB_CALLER_UID: '1000' },
    })

    expect(result.status).toBe(0)
    expect(calls).toContain(`sudo -n ${sandboxDockerdPath}`)
    expect(calls.some((call) => call.startsWith('setsid '))).toBe(false)
  })

  it('installs Docker from the official Debian repository', () => {
    const sandboxDockerfile = read(sandboxDockerfilePath)
    expect(sandboxDockerfile).toContain('https://download.docker.com/linux/debian')
    expect(sandboxDockerfile).toContain('docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin')
  })

  it('copies the startup helper into the guest image', () => {
    const sandboxDockerfile = read(sandboxDockerfilePath)
    expect(sandboxDockerfile).toMatch(/^COPY --chmod=0755 scripts\/sandbox-dockerd-start\.sh \/usr\/local\/bin\/ocm-dockerd-start$/m)
  })

  it('runs the sandbox image workflow when the helper changes', () => {
    const workflow = read(sandboxWorkflowPath)
    expect(workflow).toMatch(/pull_request:\n\s+paths:\n(?:\s+-\s+\S+\n)*\s+-\s+scripts\/sandbox-dockerd-start\.sh/)
  })
})
