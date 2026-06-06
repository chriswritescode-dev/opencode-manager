const sharedEncoder = new TextEncoder()

export function encodeSSEFrame(event: string, data: string): Uint8Array {
  const head = event ? `event: ${event}\n` : ''
  return sharedEncoder.encode(`${head}data: ${data}\n\n`)
}
