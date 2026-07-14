import { chmodSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import solidPlugin from '@opentui/solid/bun-plugin'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })

async function bundleEntry(label: string, entrypoint: string, outputName: string): Promise<void> {
  console.log(`Bundling ${label}...`)
  const result = await Bun.build({
    entrypoints: [join(root, entrypoint)],
    outdir: dist,
    target: 'node',
    format: 'esm',
    external: ['bun:sqlite'],
    naming: { entry: outputName },
  })

  if (result.success) return

  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

await bundleEntry('ocm CLI', join('bin', 'ocm.ts'), 'ocm.js')

console.log('Bundling TUI plugin...')
const tuiResult = await Bun.build({
  entrypoints: [join(root, 'src', 'tui.tsx')],
  outdir: dist,
  target: 'node',
  format: 'esm',
  plugins: [solidPlugin],
  external: ['@opentui/solid', '@opentui/core', 'solid-js'],
  naming: { entry: 'tui.js' },
})

if (!tuiResult.success) {
  for (const log of tuiResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

const ocmJsPath = join(dist, 'ocm.js')
const ocmJsContent = readFileSync(ocmJsPath, 'utf-8')
const withoutShebang = ocmJsContent.startsWith('#!') ? ocmJsContent.slice(ocmJsContent.indexOf('\n') + 1) : ocmJsContent
writeFileSync(ocmJsPath, `#!/usr/bin/env node\n${withoutShebang}`)
chmodSync(ocmJsPath, 0o755)

console.log('Build complete')
