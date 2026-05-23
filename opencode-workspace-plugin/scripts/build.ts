import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import solidPlugin from '@opentui/solid/bun-plugin'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })

console.log('Compiling server plugin (tsc)...')
execSync('tsc -p tsconfig.build.json', {
  cwd: root,
  stdio: 'inherit',
})

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

console.log('Build complete')
