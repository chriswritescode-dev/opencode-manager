import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

const root = resolve(import.meta.dir, '..')

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    console.error(`Failed: ${cmd} ${args.join(' ')}`)
    process.exit(1)
  }
}

const frontendDist = resolve(root, 'frontend', 'dist')
if (!existsSync(frontendDist)) {
  console.log('Building frontend for npm publish...')
  run('bun', ['run', 'build:frontend'])
} else {
  console.log('Frontend already built, skipping.')
}

console.log('npm package ready for publish.')
