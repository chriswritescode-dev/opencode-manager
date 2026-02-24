import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const packageJsonPath = join(__dirname, '..', 'package.json')
const versionPath = join(__dirname, '..', 'src', 'version.ts')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const version = packageJson.version as string

const versionContent = `export const VERSION = '${version}'\n`

writeFileSync(versionPath, versionContent, 'utf-8')

console.log(`Version ${version} written to src/version.ts`)
