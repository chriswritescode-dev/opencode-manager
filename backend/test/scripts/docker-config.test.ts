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
const installationDocsPath = join(repoRoot, 'docs/getting-started/installation.md')

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

  it('realigns /app only when ids changed', () => {
    const entrypoint = read(entrypointPath)

    expect(entrypoint).toContain('OCM_UID_CHANGED')
    expect(entrypoint).toContain('OCM_GID_CHANGED')

    const conditionalBlockMatch = entrypoint.match(
      /if \[ "\$OCM_UID_CHANGED" = "1" \] \|\| \[ "\$OCM_GID_CHANGED" = "1" \]; then[\s\S]*?chown -R node:node \/app\nfi/,
    )
    expect(conditionalBlockMatch, 'conditional /app realign block must exist').not.toBeNull()

    const workspaceChownMatch = entrypoint.match(/chown -R node:node [^\n]*\/workspace/)
    expect(workspaceChownMatch, 'pre-existing unconditional workspace chown must remain').not.toBeNull()
    const conditionalChownIndex = entrypoint.indexOf('chown -R node:node /app\n', conditionalBlockMatch!.index!)
    const workspaceChownIndex = entrypoint.indexOf(workspaceChownMatch![0])
    expect(conditionalChownIndex).toBeGreaterThan(workspaceChownIndex)

    expect(entrypoint).toContain('mkdir -p /app/data /workspace /home/node/.cache /home/node/.opencode')
  })

  it('does not mark the library executable in the image', () => {
    const dockerfile = read(dockerfilePath)
    expect(dockerfile).not.toMatch(/chmod \+x \/usr\/local\/lib\/ocm\/container-user\.sh/)
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

  it('links the host-access subsection from the installation guide', () => {
    const installation = read(installationDocsPath)
    expect(installation).toContain('configuration/docker.md#accessing-repositories-from-the-host')
  })

  it('documents the migration empty-destination guard and quoted host path', () => {
    const docs = read(dockerDocsPath)
    expect(docs).toContain('if [ -n "$(ls -A "<host path>")" ]; then')
    expect(docs).toContain('mkdir -p "<host path>"')
    expect(docs).toContain('-v "<host path>":/to')
    expect(docs).toContain('chown -R "$(id -u):$(id -g)" "<host path>"')
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
