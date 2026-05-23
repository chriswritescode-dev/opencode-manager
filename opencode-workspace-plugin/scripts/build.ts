import { chmodSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import solidPlugin from '@opentui/solid/bun-plugin'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })

console.log('Bundling TUI plugin (bun build)...')
const result = await Bun.build({
  entrypoints: [join(root, 'src', 'tui.tsx')],
  outdir: dist,
  target: 'node',
  plugins: [solidPlugin],
  external: [
    '@opentui/solid',
    '@opentui/core',
    '@opentui/keymap',
    '@opencode-ai/plugin',
    '@opencode-ai/plugin/tui',
    '@opencode-ai/sdk',
    '@opencode-ai/sdk/v2',
    'solid-js',
    'solid-js/store',
    'solid-js/web',
  ],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const tuiDts = `import type { TuiPluginModule } from '@opencode-ai/plugin/tui'
declare const plugin: TuiPluginModule & { id: string }
export default plugin
`
writeFileSync(join(dist, 'tui.d.ts'), tuiDts, 'utf-8')

console.log('Bundling ocm CLI (bun build)...')
const cliResult = await Bun.build({
  entrypoints: [join(root, 'bin', 'ocm.ts')],
  outdir: dist,
  target: 'bun',
  naming: { entry: 'ocm.js' },
})

if (!cliResult.success) {
  for (const log of cliResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

const ocmShim = `#!/usr/bin/env bun
import './ocm.js'
`
const ocmPath = join(dist, 'ocm')
writeFileSync(ocmPath, ocmShim, 'utf-8')
chmodSync(ocmPath, 0o755)
chmodSync(join(dist, 'ocm.js'), 0o755)

console.log('Build complete')
