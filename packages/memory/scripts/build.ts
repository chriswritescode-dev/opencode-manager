import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

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
execSync('bun build src/tui.tsx --outdir dist --target node --external "@opentui/solid" --external "@opencode-ai/plugin/tui" --external "solid-js"', { 
  cwd: join(__dirname, '..'),
  stdio: 'inherit' 
})

console.log('Build complete!')
