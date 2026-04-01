import { execFileSync } from 'child_process'
import { VERSION } from '../../version'
import { checkForUpdate, performUpgrade } from '../../utils/upgrade'

export async function run(): Promise<void> {
  const updateCheck = await checkForUpdate()

  if (!updateCheck.latest || !updateCheck.updateAvailable) {
    console.log(`Already on latest version (v${VERSION})`)
    return
  }

  console.log(`Upgrading from v${updateCheck.current} to v${updateCheck.latest}...`)

  const result = await performUpgrade(async (cacheDir, version) => {
    try {
      execFileSync('bun', ['add', '--force', '--no-cache', '--exact', '--cwd', cacheDir, `@opencode-manager/memory@${version}`], {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return { exitCode: 0, stderr: '' }
    } catch (err: unknown) {
      const error = err as { status?: number; stderr?: string }
      return { exitCode: error.status ?? 1, stderr: error.stderr ?? '' }
    }
  })

  console.log(result.message)

  if (result.upgraded) {
    console.log('Restart OpenCode to use the new version.')
  }
}

export function help(): void {
  console.log(`
Check for and install plugin updates

Usage:
  ocm-mem upgrade

Options:
  --help, -h    Show this help message
  `.trim())
}
