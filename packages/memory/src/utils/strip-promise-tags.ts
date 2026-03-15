export function stripPromiseTags(text: string): { cleaned: string; stripped: boolean } {
  let cleaned = text.replace(/\n*---\n\n\*\*IMPORTANT - Completion Signal:\*\*[\s\S]*?<promise>[\s\S]*?<\/promise>[\s\S]*?(?:until this signal is detected\.|$)/g, '')
  cleaned = cleaned.replace(/<promise>[\s\S]*?<\/promise>/g, '')
  cleaned = cleaned.trimEnd()
  return { cleaned, stripped: cleaned !== text.trimEnd() }
}
