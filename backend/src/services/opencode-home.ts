export function getOpenCodeHome(): string {
  return process.env.HOME ?? '/home/node'
}
