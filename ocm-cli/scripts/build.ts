import { chmodSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })

console.log('Bundling ocm CLI...')
const cliResult = await Bun.build({
  entrypoints: [join(root, 'bin', 'ocm.ts')],
  outdir: dist,
  target: 'node',
  format: 'esm',
  naming: { entry: 'ocm.js' },
})

if (!cliResult.success) {
  for (const log of cliResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Bundling opencode plugin entry...')
const pluginResult = await Bun.build({
  entrypoints: [join(root, 'src', 'plugin.ts')],
  outdir: dist,
  target: 'node',
  format: 'esm',
  naming: { entry: 'plugin.js' },
})

if (!pluginResult.success) {
  for (const log of pluginResult.logs) {
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
