import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import solidPlugin from '@opentui/solid/bun-plugin'

const packageJsonPath = join(__dirname, '..', 'package.json')
const versionPath = join(__dirname, '..', 'src', 'version.ts')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const version = packageJson.version as string

const versionContent = `export const VERSION = '${version}'\n`
writeFileSync(versionPath, versionContent, 'utf-8')

console.log(`Version ${version} written to src/version.ts`)

console.log('Compiling main code...')
execSync('tsc -p tsconfig.build.json', {
  cwd: join(__dirname, '..'),
  stdio: 'inherit'
})

console.log('Compiling TUI plugin...')
const result = await Bun.build({
  entrypoints: [join(__dirname, '..', 'src', 'tui.tsx')],
  outdir: join(__dirname, '..', 'dist'),
  target: 'node',
  plugins: [solidPlugin],
  external: ['@opentui/solid', '@opencode-ai/plugin/tui', 'solid-js'],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build complete!')
