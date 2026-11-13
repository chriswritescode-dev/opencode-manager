import { readFileSync } from 'fs'

export function extractShellFunction(scriptPath: string, name: string): string {
  const match = readFileSync(scriptPath, 'utf-8').match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}`, 'm'))
  if (!match) throw new Error(`${name}() not found in ${scriptPath}`)
  return match[0]
}
