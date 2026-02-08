import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { executeCommand } from './process'

async function removeFile(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {})
}

export async function validateSSHPrivateKey(key: string): Promise<{ valid: boolean; hasPassphrase: boolean; error?: string }> {
  if (!key || typeof key !== 'string') {
    return { valid: false, hasPassphrase: false, error: 'SSH key is required' }
  }

  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { valid: false, hasPassphrase: false, error: 'SSH key cannot be empty' }
  }

  let tempKeyPath: string | null = null

  try {
    tempKeyPath = join(tmpdir(), `temp-ssh-key-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.writeFile(tempKeyPath, trimmedKey + '\n', { mode: 0o600 })

    try {
      await executeCommand(['ssh-keygen', '-y', '-P', '', '-f', tempKeyPath], { silent: true })
      return { valid: true, hasPassphrase: false }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const passphrasePatterns = ['incorrect passphrase', 'bad passphrase', 'passphrase failed']
      const isPassphraseError = passphrasePatterns.some(pattern => errorMessage.toLowerCase().includes(pattern))
      
      if (isPassphraseError) {
        return { valid: true, hasPassphrase: true }
      }
      throw error
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { valid: false, hasPassphrase: false, error: `Invalid SSH key: ${errorMessage}` }
  } finally {
    if (tempKeyPath) {
      await removeFile(tempKeyPath)
    }
  }
}
