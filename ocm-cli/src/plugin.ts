import { mkdirSync, symlinkSync, lstatSync, readlinkSync, unlinkSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OCM_TARGET = join(PACKAGE_ROOT, 'dist', 'ocm.js')
const BIN_DIR = join(homedir(), '.local', 'bin')
const BIN_LINK = join(BIN_DIR, 'ocm')

function ensureSymlink(): { installed: boolean; message?: string } {
  if (!existsSync(OCM_TARGET)) {
    return { installed: false, message: `ocm-cli: missing ${OCM_TARGET}, skipping bin install` }
  }

  try {
    chmodSync(OCM_TARGET, 0o755)
  } catch {
    // best effort
  }

  try {
    mkdirSync(BIN_DIR, { recursive: true })
  } catch (err) {
    return { installed: false, message: `ocm-cli: cannot create ${BIN_DIR}: ${(err as Error).message}` }
  }

  try {
    const stat = lstatSync(BIN_LINK)
    if (stat.isSymbolicLink()) {
      if (readlinkSync(BIN_LINK) === OCM_TARGET) {
        return { installed: false }
      }
      unlinkSync(BIN_LINK)
    } else {
      return { installed: false, message: `ocm-cli: ${BIN_LINK} exists and is not a symlink; leaving alone` }
    }
  } catch {
    // missing — fine
  }

  try {
    symlinkSync(OCM_TARGET, BIN_LINK)
  } catch (err) {
    return { installed: false, message: `ocm-cli: failed to symlink ${BIN_LINK}: ${(err as Error).message}` }
  }

  const onPath = (process.env.PATH ?? '').split(':').includes(BIN_DIR)
  const pathHint = onPath ? '' : ` (add "${BIN_DIR}" to your PATH to run \`ocm\`)`
  return { installed: true, message: `ocm-cli: installed \`ocm\` at ${BIN_LINK}${pathHint}` }
}

const result = ensureSymlink()
if (result.message) {
  process.stderr.write(`${result.message}\n`)
}

const plugin = async (): Promise<Record<string, never>> => ({})
export default plugin
